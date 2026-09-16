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
 *   music part.output ─┬─ [rotate θ] ─▶ musicBus.input ─▶ [highpass] ─┐
 *                      ├─ send ─▶ return "room" (plate, 100% wet) ────┤
 *                      └─ send ─▶ return "echo" (delay) ────────────┤
 *                                                                   ▼
 *                                          musicBus.output  (the Music fader)
 *                                                                   │
 *   sfx part.output ──── [rotate θ] ─▶ sfxLevel (the SFX fader) ───┐   │
 *                                                                   │   │
 *                                                        master ◀───┴───┘
 *                                                          └─▶ limiter ─▶ out
 *
 * SFX parts get the same strip with the SFX fader as their dry destination,
 * so they skip the music bus's inserts but still have a real pan and a send.
 * `musicBus.output` and `sfxLevel` are the settings panel's two channel
 * faders (#518 decision 1): the music one is the bus's existing output gain,
 * so the dry path gains no node, and the returns are summed into it so the
 * room follows the music down. The engine's master is not a fader and never
 * becomes one.
 *
 * Music comes in as an `ArrangementDocument` (issue #75): the committed JSON,
 * normalised by `makeArrangement`. `initMusic` builds a part per entry in the
 * document's part list — on the patch its `patches` section carries, on the
 * part's own strip — and lands the `returns` overlay on the live return
 * buses; `apply` takes a deep partial of the same document model —
 * arrangement fields through the player, `patches` onto the parts, each
 * part's `strip` and the `returns` onto the live desk (`deskApply.ts`).
 */
import type { ArrangementPartial } from './arrangement';
import type { ArrangementDocument, DocumentPartial } from './arrangementDocument';
import type {
  ApplyResult,
  ArrangementReadout,
  MusicEventHandler,
  PlayablePart,
} from './arrangementPlayer';
import { ArrangementPlayer } from './arrangementPlayer';
import { PatchResolver } from './arrangementValidate';
import { AUDIO_LOAD_REPORT_SECONDS, MUSIC_PART_MAX_VOICES } from './audioConstants';
import type { AudioCostReadout } from './audioCost';
import type { AudioLoadReadout } from './audioLoad';
import { AudioLoadMeter, meterNode } from './audioLoad';
import { asPlaybackStatsHost, snapshotPlaybackStats } from './playbackStats';
import { SchedCostMeter } from './schedCost';
import type { AudioBus } from './audioBus';
import type { AudioPart } from './audioPart';
import type { NotePattern } from './capturedPattern';
import type { PartStrip } from './channelStrip';
import { routePart } from './channelStrip';
import { applyReturnsLive, applyStripLive } from './deskApply';
import { musicPartName } from './documentParts';
import { FmEngine } from './fmEngine';
import type { ChannelStrip, ReturnSpec } from './mix';
import { MIX, RETURNS, stripFor } from './mix';
import type { Patch } from './patch';
import { clonePatch } from './patch';
import { GAMEPLAY_PATCHES, type GameplayPatchId } from './gameplayPatches';
import type { ReturnBus } from './returnBus';
import { createReturns } from './returnBus';
import { Scheduler } from './scheduler';

/**
 * A document parts partial split in two (#597): what the player merges, and
 * each slot's `strip` partial, which lands on the live graph instead.
 */
function splitStrips(parts: DocumentPartial['parts']): {
  arrangementParts: Record<string, unknown> | undefined;
  strips: Array<readonly [string, unknown]>;
} {
  if (parts === undefined) return { arrangementParts: undefined, strips: [] };
  if (typeof parts !== 'object' || parts === null || Array.isArray(parts)) {
    return { arrangementParts: parts as Record<string, unknown>, strips: [] };
  }
  const arrangementParts: Record<string, unknown> = {};
  const strips: Array<readonly [string, unknown]> = [];
  for (const [slot, raw] of Object.entries(parts as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      arrangementParts[slot] = raw;
      continue;
    }
    const { strip, ...rest } = raw as Record<string, unknown>;
    if (strip !== undefined) strips.push([slot, strip]);
    arrangementParts[slot] = rest;
  }
  return { arrangementParts, strips };
}

export interface AudioSystemOptions {
  /** Start suspended and wait for a gesture. Always true in a real page. */
  autoUnlock?: boolean;
  /** The desk. Defaults to `MIX`; a test or the console (#70) may hand in its own. */
  mix?: Readonly<Record<string, ChannelStrip>>;
  /** The returns to build. Defaults to `RETURNS`. */
  returns?: Readonly<Record<string, ReturnSpec>>;
  /**
   * The main-thread clock `update()` times itself with (#275 decision 7).
   * Injected so a test can assert the scheduling cost without a real one.
   */
  now?: () => number;
}

/** `__a204.audio.readout()` (issue #69): the arrangement's state plus the system's. */
export interface MusicReadout extends ArrangementReadout {
  muted: boolean;
  running: boolean;
  /** What the DSP costs on the audio thread (#445); all zeros until it reports. */
  load: AudioLoadReadout;
}

export class AudioSystem {
  readonly engine: FmEngine;
  readonly scheduler: Scheduler;

  private readonly mix: Readonly<Record<string, ChannelStrip>>;
  private readonly returnSpecs: Readonly<Record<string, ReturnSpec>>;
  private musicBus: AudioBus | null = null;
  private returns: Readonly<Record<string, ReturnBus>> | null = null;
  /** The SFX strips' dry summing gain — the SFX fader (#518); built by `init()`. */
  private sfxLevel: GainNode | null = null;
  private musicGainValue = 1;
  private sfxGainValue = 1;
  private readonly strips = new Map<string, PartStrip>();
  private readonly loadMeter = new AudioLoadMeter();
  /** What `update()` costs on the main thread, over the rolling window (#275). */
  private readonly schedMeter: SchedCostMeter;
  private readonly now: () => number;
  private started = false;
  private player: ArrangementPlayer | null = null;
  private muted = false;
  private suppressed = false;

  constructor(engine?: FmEngine, options: AudioSystemOptions = {}) {
    this.engine = engine ?? new FmEngine();
    this.scheduler = new Scheduler(this.engine.context, { bpm: 96 });
    this.mix = options.mix ?? MIX;
    this.returnSpecs = options.returns ?? RETURNS;
    this.now = options.now ?? ((): number => performance.now());
    this.schedMeter = new SchedCostMeter({ now: this.now });
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
    // The returns land on the music bus's output gain rather than on the
    // master (#518 decision 1), so the music fader — which *is* that gain —
    // takes the room and the echo down with the parts feeding them. They sit
    // after the bus's highpass, exactly as they did on the master.
    this.returns = createReturns(this.engine.context, this.returnSpecs, this.musicBus.output);
    this.sfxLevel = this.engine.context.createGain();
    this.sfxLevel.connect(this.engine.master);
    // A level set before `init()` (the settings read at boot) lands on the
    // nodes the moment they exist, so no sound is ever made at the wrong one.
    this.musicBus.output.gain.value = this.musicGainValue;
    this.sfxLevel.gain.value = this.sfxGainValue;
    // The plate is a standing processor on the audio thread, so it reports too
    // (#445): a load figure that counted only the parts would understate the
    // music by the whole reverb.
    for (const [name, bus] of Object.entries(this.returns)) {
      this.meterLoad(`return:${name}`, bus.effect);
    }
    this.started = true;
  }

  /** Call from a click or key handler. */
  async unlock(): Promise<void> {
    await this.engine.unlock();
  }

  /**
   * Unlock and start the transport with no gesture behind it — bench mode
   * (`?bench=1&audio=1`, #445), where the page has no input and Chrome is
   * launched with `--autoplay-policy=no-user-gesture-required`. The same two
   * steps `musicControls.ts` binds to the first pointer or key; here they run
   * directly, and the resulting context state is what the bench header
   * records. A page that stays `suspended` is a recorder failure, not a
   * silent control, so the state is returned rather than swallowed.
   */
  async startWithoutGesture(): Promise<AudioContextState> {
    const state = await this.engine.unlock();
    this.startMusic();
    return state;
  }

  /** What the DSP costs on the audio thread right now (#445). */
  loadReadout(): AudioLoadReadout {
    return this.loadMeter.readout();
  }

  /**
   * What audio costs this page, in one call (#275): the DSP's estimated load,
   * the main thread's measured scheduling cost, and the context's lifetime
   * playback counters where the browser has them.
   *
   * This is the overlay's and the bench collector's hook (`stats.audioReadout`).
   * `playback` is snapshotted on every call — the API hands back one live
   * object whose fields mutate, so a held reference is not a reading.
   */
  costReadout(): AudioCostReadout {
    return {
      load: this.loadMeter.readout(),
      sched: this.schedMeter.readout(),
      playback: snapshotPlaybackStats(asPlaybackStatsHost(this.engine.context)),
    };
  }

  /** Processors this system has turned load reporting on in (#445) — parts plus worklet returns. */
  get meteredProcessors(): number {
    return this.loadMeter.processorCount;
  }

  /** Create a part on its strip, dry into the music bus. The patch is the caller's — no name is resolved here (#562). */
  createMusicPart(
    name: string,
    patch: Patch,
    maxVoices = MUSIC_PART_MAX_VOICES,
    strip?: ChannelStrip,
  ): AudioPart {
    const { musicBus } = this.standing();
    return this.route(name, patch, maxVoices, musicBus.input, strip);
  }

  /**
   * Create a part on its strip, dry into the SFX fader, for UI and close-up
   * SFX. The fader is one `GainNode` at unity until the settings move it
   * (#518), so a part's path to the master is otherwise what it always was.
   */
  createSfxPart(name: string, id: GameplayPatchId, maxVoices = 8): AudioPart {
    this.standing();
    // Gameplay sounds are not songs: they still resolve by library id (#562),
    // through the two-entry table the game bundles.
    return this.route(name, clonePatch(GAMEPLAY_PATCHES[id]), maxVoices, this.sfxNode());
  }

  /**
   * The music fader (#518 decision 1): the music bus's own output gain, which
   * every music part and both returns pass through. Safe before `init()` —
   * the value is held and applied when the graph is built.
   */
  setMusicGain(gain: number): void {
    this.musicGainValue = gain;
    if (this.musicBus) this.musicBus.output.gain.value = gain;
  }

  /** The SFX strips' fader; the spatial engine's half is `mixLevels.ts`. */
  setSfxGain(gain: number): void {
    this.sfxGainValue = gain;
    if (this.sfxLevel) this.sfxLevel.gain.value = gain;
  }

  get musicGain(): number {
    return this.musicGainValue;
  }

  get sfxGain(): number {
    return this.sfxGainValue;
  }

  /**
   * Build a music part per part the document lists and bind the generators
   * to the transport (issues #69, #75, #597). Each part lands on its own
   * strip and is registered under its slot (`musicPartName`), never its
   * label; a `none` part is built and playable but nothing sequences it. Idempotent. Nothing sounds until `startMusic()`; under
   * `?music=0` main.ts builds this but never starts the transport, so the
   * whole graph exists on a silent page (refinement decision 2).
   *
   * Throws, naming the part and the id, when the document does not carry a
   * patch a part names (#562). That is deliberate: a song is self-contained,
   * and a silent fall back to the library is how improving a patch would have
   * changed a shipped song. `arrangementGate.test.ts` fails the build long
   * before a committed document could reach here.
   */
  initMusic(document: ArrangementDocument, onEvent?: MusicEventHandler): void {
    if (this.player) return;
    const { returns, patches, ...arrangement } = document;
    // The document and nothing else (#562): a song carries a snapshot of
    // every patch it plays, so the library is not a runtime import and a
    // name it does not embed is a load error, never a silent fallback.
    const resolver = new PatchResolver(patches ?? {});
    const parts = new Map<number, PlayablePart>();
    for (const part of arrangement.parts) {
      parts.set(
        part.slot,
        this.createMusicPart(
          musicPartName(part.slot),
          clonePatch(resolver.require(`part ${part.slot}`, part.preset)),
          MUSIC_PART_MAX_VOICES,
          part.strip,
        ),
      );
    }
    if (returns) applyReturnsLive(this.standing().returns, returns);
    this.player = new ArrangementPlayer(
      this.scheduler,
      parts,
      arrangement,
      resolver.table(),
      onEvent,
    );
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
   * nothing — and a part's `strip` lands on its live strip, only the fields
   * the partial names, with unknown names reported in `ignored` (#597).
   */
  apply(partial: DocumentPartial): ApplyResult {
    if (!this.player) return { ok: false, ignored: [], error: 'music is not initialised' };
    const { returns, patches, parts, ...rest } = partial;
    const { arrangementParts, strips } = splitStrips(parts);
    const result = this.player.apply(
      arrangementParts === undefined
        ? rest
        : { ...rest, parts: arrangementParts as NonNullable<ArrangementPartial['parts']> },
      patches ?? {},
    );
    if (!result.ok) return result;
    const ignored = [...result.ignored];
    for (const [slot, strip] of strips) {
      const live = this.strips.get(musicPartName(Number(slot)));
      // An absent slot was already reported by the player's merge.
      if (live) ignored.push(...applyStripLive(live, strip, `parts.${slot}.strip`));
    }
    if (returns !== undefined) ignored.push(...applyReturnsLive(this.standing().returns, returns));
    return { ok: true, ignored };
  }

  readout(): MusicReadout {
    const base: ArrangementReadout = this.player?.readout() ?? {
      bpm: this.scheduler.bpm,
      root: NaN,
      scale: [],
      counters: {},
    };
    return {
      ...base,
      muted: this.muted,
      running: this.scheduler.isRunning,
      load: this.loadMeter.readout(),
    };
  }

  /** The sounding pattern of the part on `slot` (issue #70 capture); null before one exists. */
  capturePattern(slot: number): readonly boolean[] | NotePattern | null {
    return this.player?.capturePattern(slot) ?? null;
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
    // Timed here rather than around the whole system because this call *is*
    // the system's per-frame main-thread work: everything else audio does
    // happens on the audio thread or on an event (#275 decision 7).
    const before = this.now();
    this.scheduler.update();
    this.schedMeter.sample(this.now() - before);
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
    this.loadMeter.dispose();
    this.schedMeter.reset();
    this.engine.dispose();
    this.musicBus = null;
    this.returns = null;
    this.sfxLevel = null;
    this.started = false;
  }

  private standing(): { musicBus: AudioBus; returns: Readonly<Record<string, ReturnBus>> } {
    if (!this.musicBus || !this.returns) {
      throw new Error('AudioSystem.init() must be awaited first');
    }
    return { musicBus: this.musicBus, returns: this.returns };
  }

  private sfxNode(): GainNode {
    if (!this.sfxLevel) throw new Error('AudioSystem.init() must be awaited first');
    return this.sfxLevel;
  }

  private route(
    name: string,
    patch: Patch,
    maxVoices: number,
    dry: AudioNode,
    strip?: ChannelStrip,
  ): AudioPart {
    const { returns } = this.standing();
    const part = this.engine.createPart(name, { patch, maxVoices, destination: null });
    this.meterLoad(`part:${name}`, part.node);
    this.strips.set(name, routePart(part, strip ?? stripFor(this.mix, name), returns, dry));
    return part;
  }

  /** Turn the audio-load sampler on in one node's processor (#445); `audioLoad.ts` owns the rules. */
  private meterLoad(id: string, node: AudioNode): void {
    meterNode(this.loadMeter, id, node, this.engine.context.sampleRate, AUDIO_LOAD_REPORT_SECONDS);
  }
}
