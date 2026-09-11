/**
 * The audio system: constructed by `main.ts`, updated by the render loop.
 *
 * Audio observes; it never decides. Simulation events flow one way -- the sim
 * emits, this subscribes and makes noise. Nothing here may feed back into
 * simulation state, or the determinism guarantee in CLAUDE.md invariant 1 stops
 * meaning anything: a dropped or late sound must be invisible to the server.
 *
 * The standing graph, per docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md:
 *
 *   part.output ─┬─ [rotate θ] ─▶ musicBus ─▶ [highpass] ─▶ master ─▶ limiter ─▶ out
 *                ├─ send ─▶ return "room" (plate, 100% wet) ─▶ master
 *                └─ send ─▶ return "echo" (delay)           ─▶ master
 *
 * SFX parts get the same strip with the master as their dry destination, so
 * they skip the music bus's inserts but still have a real pan and a send.
 *
 * Music comes in as an `ArrangementDocument` (issue #75): the committed JSON,
 * normalised by `makeArrangement`. `initMusic` builds a part per section the
 * document defines — on the document's own patch where `patches` names it,
 * on the document's strip overlay where `mix` does — and lands the `returns`
 * overlay on the live return buses; `apply` takes a deep partial of the same
 * document model — arrangement fields through the player, `patches` onto the
 * parts, `mix` and `returns` onto the live desk (`deskApply.ts`).
 */
import type { DeepPartial } from './arrangement';
import type { ArrangementDocument } from './arrangementDocument';
import type {
  ApplyResult,
  ArrangementReadout,
  MusicEventHandler,
  MusicPartId,
  PlayablePart,
} from './arrangementPlayer';
import { ArrangementPlayer, MUSIC_PART_IDS } from './arrangementPlayer';
import type { PresetTable } from './arrangementValidate';
import { MUSIC_PART_MAX_VOICES } from './audioConstants';
import type { AudioBus } from './audioBus';
import type { AudioPart } from './audioPart';
import type { NotePattern } from './capturedPattern';
import type { PartStrip } from './channelStrip';
import { routePart } from './channelStrip';
import { applyMixLive, applyReturnsLive } from './deskApply';
import { FmEngine } from './fmEngine';
import type { ChannelStrip, ReturnSpec } from './mix';
import { MIX, RETURNS, stripFor } from './mix';
import type { Patch } from './patch';
import { clonePatch } from './patch';
import { PRESETS } from './presets';
import type { ReturnBus } from './returnBus';
import { createReturns } from './returnBus';
import { Scheduler } from './scheduler';

export interface AudioSystemOptions {
  /** Start suspended and wait for a gesture. Always true in a real page. */
  autoUnlock?: boolean;
  /** The desk. Defaults to `MIX`; a test or the console (#70) may hand in its own. */
  mix?: Readonly<Record<string, ChannelStrip>>;
  /** The returns to build. Defaults to `RETURNS`. */
  returns?: Readonly<Record<string, ReturnSpec>>;
}

/** `__a204.audio.readout()` (issue #69): the arrangement's state plus the system's. */
export interface MusicReadout extends ArrangementReadout {
  muted: boolean;
  running: boolean;
}

export class AudioSystem {
  readonly engine: FmEngine;
  readonly scheduler: Scheduler;

  private readonly mix: Readonly<Record<string, ChannelStrip>>;
  private readonly returnSpecs: Readonly<Record<string, ReturnSpec>>;
  private musicBus: AudioBus | null = null;
  private returns: Readonly<Record<string, ReturnBus>> | null = null;
  private readonly strips = new Map<string, PartStrip>();
  private started = false;
  private player: ArrangementPlayer | null = null;
  private muted = false;
  private suppressed = false;

  constructor(engine?: FmEngine, options: AudioSystemOptions = {}) {
    this.engine = engine ?? new FmEngine();
    this.scheduler = new Scheduler(this.engine.context, { bpm: 96 });
    this.mix = options.mix ?? MIX;
    this.returnSpecs = options.returns ?? RETURNS;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Load the worklets and build the standing bus and returns. Safe to call
   * before a user gesture; nothing sounds until `unlock()`.
   */
  async init(): Promise<void> {
    if (this.started) return;
    await this.engine.init();
    this.musicBus = this.engine.createBus({ filter: { type: 'highpass', frequency: 30 } });
    this.returns = createReturns(this.engine.context, this.returnSpecs, this.engine.master);
    this.started = true;
  }

  /** Call from a click or key handler. */
  async unlock(): Promise<void> {
    await this.engine.unlock();
  }

  /** Create a part on its strip, dry into the music bus. `sound` is a preset name or a patch. */
  createMusicPart(
    name: string,
    sound: string | Patch,
    maxVoices = MUSIC_PART_MAX_VOICES,
    strip?: ChannelStrip,
  ): AudioPart {
    const { musicBus } = this.standing();
    return this.route(name, sound, maxVoices, musicBus.input, strip);
  }

  /** Create a part on its strip, dry into the master, for UI and close-up SFX. */
  createSfxPart(name: string, preset: string, maxVoices = 8): AudioPart {
    this.standing();
    return this.route(name, preset, maxVoices, this.engine.master);
  }

  /**
   * Build a music part per section the document defines and bind the
   * generators to the transport (issues #69, #75). A part lands on the
   * document's strip overlay when the `mix` section names it, on the code's
   * `MIX` otherwise. Idempotent. Nothing sounds until `startMusic()`; under
   * `?music=0` main.ts builds this but never starts the transport, so the
   * whole graph exists on a silent page (refinement decision 2).
   */
  initMusic(document: ArrangementDocument, onEvent?: MusicEventHandler): void {
    if (this.player) return;
    const { mix, returns, patches, ...arrangement } = document;
    // The document's patches over the code's presets: a name resolves here
    // first, so a document patch shadows a built-in of the same name.
    const presets: PresetTable = { ...PRESETS, ...patches };
    const parts: Partial<Record<MusicPartId, PlayablePart>> = {};
    for (const id of MUSIC_PART_IDS) {
      const section = arrangement[id];
      if (!section) continue;
      const patch = presets[section.preset];
      parts[id] = this.createMusicPart(
        section.part,
        patch ? clonePatch(patch) : section.preset,
        MUSIC_PART_MAX_VOICES,
        mix?.[section.part],
      );
    }
    if (returns) applyReturnsLive(this.standing().returns, returns);
    this.player = new ArrangementPlayer(this.scheduler, parts, arrangement, onEvent, presets);
  }

  /**
   * `?music=0` (decision 2): keep the whole graph but never start the
   * transport — not at unlock, and not through an unmute, the debug shim's
   * included. Enforced here so no caller can bypass the suppression.
   */
  suppressMusic(): void {
    this.suppressed = true;
    this.scheduler.stop();
  }

  /** Start (or resume) the transport. Called at the unlock gesture; a no-op while muted or suppressed. */
  startMusic(): void {
    if (!this.player || this.muted || this.suppressed) return;
    this.scheduler.start(this.scheduler.transport.currentTick);
  }

  get musicRunning(): boolean {
    return this.scheduler.isRunning;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Mute stops the transport and releases everything held, so tails ring out
   * rather than cutting; unmute resumes at the tick the transport stopped on,
   * which keeps the bar phase every regeneration hangs off.
   */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    if (muted) {
      this.scheduler.stop();
      this.player?.releaseAll(this.engine.context.currentTime);
    } else {
      this.startMusic();
    }
  }

  /** Scriptable toggle for `__a204.audio.toggleMute` (#69); the `M` key and `music on|off` use `setMuted`. Returns the new muted state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /**
   * Live tuning over the document model (refinement decision 3; issue #75):
   * merge a partial document over the current state. Arrangement fields go
   * through the player — a merged arrangement that fails validation changes
   * nothing — and `mix` entries land on the live strips, only the fields the
   * partial names, with unknown names reported in `ignored`.
   */
  apply(partial: DeepPartial<ArrangementDocument>): ApplyResult {
    if (!this.player) return { ok: false, ignored: [], error: 'music is not initialised' };
    const { mix, returns, patches, ...rest } = partial;
    const result = this.player.apply(rest);
    if (!result.ok) return result;
    const ignored = [...result.ignored];
    if (patches !== undefined) ignored.push(...this.player.applyPatches(patches));
    if (mix !== undefined) ignored.push(...applyMixLive(this.strips, mix));
    if (returns !== undefined) ignored.push(...applyReturnsLive(this.standing().returns, returns));
    return { ok: true, ignored };
  }

  readout(): MusicReadout {
    const base: ArrangementReadout = this.player?.readout() ?? {
      bpm: this.scheduler.bpm,
      root: NaN,
      scale: [],
      counters: { kick: 0, hat: 0, arp: 0, drone: 0 },
    };
    return { ...base, muted: this.muted, running: this.scheduler.isRunning };
  }

  /** The sounding pattern of a music part (issue #70 capture); null before one exists. */
  capturePattern(id: 'kick' | 'hat'): readonly boolean[] | null;
  capturePattern(id: 'arp' | 'drone'): NotePattern | null;
  capturePattern(id: MusicPartId): readonly boolean[] | NotePattern | null;
  capturePattern(id: MusicPartId): readonly boolean[] | NotePattern | null {
    return this.player?.capturePattern(id) ?? null;
  }

  /** The live strip of a part this system created. */
  strip(name: string): PartStrip | undefined {
    return this.strips.get(name);
  }

  /** A return by name, once `init()` has built them. */
  returnBus(name: string): ReturnBus | undefined {
    return this.returns?.[name];
  }

  /**
   * Driven by the render loop. Only pumps the look-ahead queue -- the times it
   * emits come from the audio clock, so a long frame delays the check, never
   * the note.
   */
  update(_dt: number): void {
    if (!this.started) return;
    this.scheduler.update();
  }

  dispose(): void {
    this.scheduler.stop();
    this.player?.dispose();
    this.player = null;
    this.muted = false;
    this.suppressed = false;
    for (const strip of this.strips.values()) strip.dispose();
    this.strips.clear();
    if (this.returns) for (const bus of Object.values(this.returns)) bus.dispose();
    this.engine.dispose();
    this.musicBus = null;
    this.returns = null;
    this.started = false;
  }

  private standing(): { musicBus: AudioBus; returns: Readonly<Record<string, ReturnBus>> } {
    if (!this.musicBus || !this.returns) {
      throw new Error('AudioSystem.init() must be awaited first');
    }
    return { musicBus: this.musicBus, returns: this.returns };
  }

  private route(
    name: string,
    sound: string | Patch,
    maxVoices: number,
    dry: AudioNode,
    strip?: ChannelStrip,
  ): AudioPart {
    const { returns } = this.standing();
    const source = typeof sound === 'string' ? { preset: sound } : { patch: sound };
    const part = this.engine.createPart(name, { ...source, maxVoices, destination: null });
    this.strips.set(name, routePart(part, strip ?? stripFor(this.mix, name), returns, dry));
    return part;
  }
}
