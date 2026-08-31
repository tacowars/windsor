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
 * document defines, on the document's strip overlay where it has one, and
 * `apply` takes a deep partial of the same document model — arrangement fields
 * through the player, `mix` straight onto the live strips.
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
import type { AudioBus } from './audioBus';
import type { AudioPart } from './audioPart';
import type { PartStrip } from './channelStrip';
import { routePart } from './channelStrip';
import { FmEngine } from './fmEngine';
import type { ChannelStrip, ReturnSpec } from './mix';
import { MIX, RETURNS, stripFor } from './mix';
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

const STRIP_KEYS = ['level', 'pan', 'sends'];
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

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

  /** Create a part on its strip, dry into the music bus. */
  createMusicPart(name: string, preset: string, maxVoices = 12, strip?: ChannelStrip): AudioPart {
    const { musicBus } = this.standing();
    return this.route(name, preset, maxVoices, musicBus.input, strip);
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
    const { mix, ...arrangement } = document;
    const parts: Partial<Record<MusicPartId, PlayablePart>> = {};
    for (const id of MUSIC_PART_IDS) {
      const section = arrangement[id];
      if (!section) continue;
      parts[id] = this.createMusicPart(section.part, section.preset, 12, mix?.[section.part]);
    }
    this.player = new ArrangementPlayer(this.scheduler, parts, arrangement, onEvent);
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

  /** The M key's toggle (main.ts). Returns the new muted state. */
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
    const { mix, ...rest } = partial;
    const result = this.player.apply(rest);
    if (!result.ok || mix === undefined) return result;
    return { ok: true, ignored: [...result.ignored, ...this.applyMix(mix)] };
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

  private applyMix(mix: DeepPartial<Readonly<Record<string, ChannelStrip>>>): string[] {
    const ignored: string[] = [];
    for (const [name, raw] of Object.entries(mix)) {
      if (raw === undefined) continue;
      const strip = this.strips.get(name);
      if (!strip || typeof raw !== 'object' || raw === null) {
        ignored.push(`mix.${name}`);
        continue;
      }
      const o = raw as Record<string, unknown>;
      for (const key of Object.keys(o)) {
        if (!STRIP_KEYS.includes(key)) ignored.push(`mix.${name}.${key}`);
      }
      if (typeof o.level === 'number' && Number.isFinite(o.level)) {
        strip.setLevel(clamp(o.level, 0, 4));
      } else if (o.level !== undefined) ignored.push(`mix.${name}.level`);
      if (typeof o.pan === 'number' && Number.isFinite(o.pan)) {
        strip.setPan(clamp(o.pan, -1, 1));
      } else if (o.pan !== undefined) ignored.push(`mix.${name}.pan`);
      if (o.sends !== undefined) this.applySends(strip, name, o.sends, ignored);
    }
    return ignored;
  }

  private applySends(strip: PartStrip, name: string, sends: unknown, ignored: string[]): void {
    if (typeof sends !== 'object' || sends === null) {
      ignored.push(`mix.${name}.sends`);
      return;
    }
    for (const [ret, amount] of Object.entries(sends)) {
      if (!strip.sends.has(ret) || typeof amount !== 'number' || !Number.isFinite(amount)) {
        ignored.push(`mix.${name}.sends.${ret}`);
        continue;
      }
      strip.setSend(ret, clamp(amount, 0, 1));
    }
  }

  private standing(): { musicBus: AudioBus; returns: Readonly<Record<string, ReturnBus>> } {
    if (!this.musicBus || !this.returns) {
      throw new Error('AudioSystem.init() must be awaited first');
    }
    return { musicBus: this.musicBus, returns: this.returns };
  }

  private route(
    name: string,
    preset: string,
    maxVoices: number,
    dry: AudioNode,
    strip?: ChannelStrip,
  ): AudioPart {
    const { returns } = this.standing();
    const part = this.engine.createPart(name, { preset, maxVoices, destination: null });
    this.strips.set(name, routePart(part, strip ?? stripFor(this.mix, name), returns, dry));
    return part;
  }
}
