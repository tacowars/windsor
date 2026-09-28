/**
 * The audio system: the standing graph a page plays through. The console
 * (`packages/app/src/host.ts`) constructs it and pumps `update()` from its
 * frame loop.
 *
 * The standing graph, per docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md:
 *
 *   music part.output ─▶ [stages…] ─▶ tail ─┬─ [rotate θ] ─▶ musicBus.input ─▶ [highpass] ─┐
 *                                           ├─ send ─▶ return "room" (plate, 100% wet) ────┤
 *                                           └─ send ─▶ return "echo" (delay) ──────────────┤
 *                                                                                          ▼
 *                                                          song master inserts/level → musicBus.output (the Music fader)
 *                                                                                          │
 *   aux part.output ─▶ [stages…] ─▶ tail ─── [rotate θ] ─▶ auxLevel ─▶ master ◀────────────┘
 *                                                                      └─▶ limiter ─▶ out
 *
 * Each strip's stages sit between the part and its tail, and the rotation and
 * the sends both tap the tail (#639). The first stage is always the strip's
 * low cut (#640), so a room hears the cut signal too. Aux parts — an
 * audition, a metronome, anything outside the song — get the same strip with
 * the aux fader as their dry destination, so they skip the song master but
 * still have a real pan and a send. `musicBus.output` and `auxLevel` are the
 * two channel faders (#518 decision 1): the music one is the bus's existing output gain,
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
import { splitStrips } from '../mixer/deskPartial';
import { SidechainDesk } from '../mixer/sidechainDesk';
import type { ArrangementPartial, MusicPart } from '../song/arrangement';
import type { ArrangementDocument, DocumentPartial } from '../song/arrangementDocument';
import type {
  ApplyResult,
  ArrangementReadout,
  MusicEventHandler,
  PartHost,
} from '../song/arrangementPlayer';
import { ArrangementPlayer } from '../song/arrangementPlayer';
import { PatchResolver } from '../song/arrangementValidate';
import { AUDIO_LOAD_REPORT_SECONDS, MUSIC_PART_MAX_VOICES } from '../audioConstants';
import type { AudioLoadReadout } from '../cost/audioLoad';
import { AudioLoadMeter, meterNode } from '../cost/audioLoad';
import type { AudioBus } from '../mixer/audioBus';
import type { AudioPart } from '../synth/audioPart';
import type { PartStrip } from '../mixer/channelStrip';
import type { RouteOptions } from '../mixer/channelStrip';
import { routePart } from '../mixer/channelStrip';
import { applyReturnsLive, applyStripLive } from '../mixer/deskApply';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import type { ChannelStrip, ReturnSpec } from '../mixer/mix';
import { MIX, RETURNS, stripFor } from '../mixer/mix';
import type { Patch } from '../patch/patch';
import { clonePatch } from '../patch/patch';
import type { ReturnBus } from '../mixer/returnBus';
import { createReturns } from '../mixer/returnBus';
import { Scheduler } from '../sequencing/scheduler';

export interface AudioSystemOptions {
  /** Start suspended and wait for a gesture. Always true in a real page. */
  autoUnlock?: boolean;
  /** The desk. Defaults to `MIX`; a test or the console (#70) may hand in its own. */
  mix?: Readonly<Record<string, ChannelStrip>>;
  /** The returns to build. Defaults to `RETURNS`. */
  returns?: Readonly<Record<string, ReturnSpec>>;
  /**
   * How a strip waits out the fade around a structural insert edit (#652).
   * Defaults to `setTimeout`; a test hands in something immediate.
   */
  defer?: RouteOptions['defer'];
  /**
   * The random seed each part's processor is built with, by engine part name
   * (windsor#40). Absent — live playback — every part draws from
   * `Math.random`; the offline song render pins one per part.
   */
  partSeed?: (name: string) => number;
}

/** `AudioSystem.readout()` (issue #69): the arrangement's state plus the system's. */
export interface MusicReadout extends ArrangementReadout {
  muted: boolean;
  running: boolean;
  /** What the DSP costs on the audio thread (#445); all zeros until it reports. */
  load: AudioLoadReadout;
}

import { createMasterStrip } from '../mixer/masterStrip';
import type { MasterStrip } from '../mixer/masterStrip';
import { tempoInsertRegistry } from '../inserts/tempoInsertRegistry';
import { meteredInsertRegistry } from '../inserts/meteredInsertRegistry';

export class AudioSystem {
  readonly engine: FmEngine;
  readonly scheduler: Scheduler;

  private readonly mix: Readonly<Record<string, ChannelStrip>>;
  private readonly returnSpecs: Readonly<Record<string, ReturnSpec>>;
  private musicBus: AudioBus | null = null;
  private masterStripValue: MasterStrip | null = null;
  private returns: Readonly<Record<string, ReturnBus>> | null = null;
  /** The aux strips' dry summing gain — the aux fader (#518); built by `init()`. */
  private auxLevel: GainNode | null = null;
  private musicGainValue = 1;
  private auxGainValue = 1;
  private readonly strips = new Map<string, PartStrip>();
  /** The music parts by slot — the player's roster, grown and shrunk live through `apply` (#629). */
  private readonly musicParts = new Map<number, AudioPart>();
  private readonly loadMeter = new AudioLoadMeter();
  /** Passed to every strip: how it waits out an insert fade (#652). */
  private readonly routeOptions: RouteOptions;
  private readonly partSeed: ((name: string) => number) | undefined;
  private readonly sidechains = new SidechainDesk(
    () =>
      new Map(
        [...this.musicParts.keys()].flatMap((slot) => {
          const strip = this.strips.get(musicPartName(slot));
          return strip ? [[slot, strip] as const] : [];
        }),
      ),
    () => this.masterStrip,
  );
  private started = false;
  private player: ArrangementPlayer | null = null;
  private readonly insertTempo: ReturnType<typeof tempoInsertRegistry>;
  private muted = false;

  constructor(engine?: FmEngine, options: AudioSystemOptions = {}) {
    this.engine = engine ?? new FmEngine();
    this.scheduler = new Scheduler(this.engine.context, { bpm: 96 });
    this.mix = options.mix ?? MIX;
    this.returnSpecs = options.returns ?? RETURNS;
    this.partSeed = options.partSeed;
    this.insertTempo = tempoInsertRegistry(this.scheduler.bpm);
    this.routeOptions = {
      registry: meteredInsertRegistry(this.loadMeter, this.insertTempo.registry),
      changed: () => this.sidechains.changed(),
      ...(options.defer ? { defer: options.defer } : {}),
    };
  }

  /** The song master, distinct from the engine-wide safety output and the channel faders. */
  get masterStrip(): MasterStrip | null {
    return this.masterStripValue;
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
    // Keep the dry-only highpass. Returns join after it, before song inserts.
    const master = createMasterStrip(this.engine.context, this.routeOptions);
    this.masterStripValue = master;
    this.musicBus.filter!.disconnect(this.musicBus.output);
    this.musicBus.filter!.connect(master.input);
    master.output.connect(this.musicBus.output);
    this.returns = createReturns(this.engine.context, this.returnSpecs, master.input);
    this.auxLevel = this.engine.context.createGain();
    this.auxLevel.connect(this.engine.master);
    // A level set before `init()` (a saved setting read at boot) lands on the
    // nodes the moment they exist, so no sound is ever made at the wrong one.
    this.musicBus.output.gain.value = this.musicGainValue;
    this.auxLevel.gain.value = this.auxGainValue;
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
   * Create a part on its strip, dry into the aux fader: a sound outside the
   * song, such as an audition or a metronome, that must not pass the song
   * master. The fader is one `GainNode` at unity until `setAuxGain` moves it
   * (#518), so a part's path to the master is otherwise what it always was.
   * The patch is the caller's, as for a music part (#562).
   */
  createAuxPart(name: string, patch: Patch, maxVoices = 8): AudioPart {
    this.standing();
    return this.route(name, patch, maxVoices, this.auxNode());
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

  /** The aux strips' fader. Safe before `init()`, like the music fader. */
  setAuxGain(gain: number): void {
    this.auxGainValue = gain;
    if (this.auxLevel) this.auxLevel.gain.value = gain;
  }

  get musicGain(): number {
    return this.musicGainValue;
  }

  get auxGain(): number {
    return this.auxGainValue;
  }

  /**
   * Build a music part per part the document lists and bind the generators
   * to the transport (issues #69, #75, #597). Each part lands on its own
   * strip and is registered under its slot (`musicPartName`), never its
   * label; a `none` part is built and playable but nothing sequences it.
   * Idempotent. Nothing sounds until `startMusic()`.
   *
   * Throws, naming the part and the id, when the document does not carry a
   * patch a part names (#562). That is deliberate: a song is self-contained,
   * and a silent fall back to the library is how improving a patch would have
   * changed a shipped song. `arrangementGate.test.ts` fails the build long
   * before a committed document could reach here.
   */
  initMusic(document: ArrangementDocument, onEvent?: MusicEventHandler): void {
    if (this.player) return;
    const routing = this.sidechains.check(document);
    this.sidechains.begin();
    const { returns, patches, master, ...arrangement } = document;
    // The document and nothing else (#562): a song carries a snapshot of
    // every patch it plays, so the library is not a runtime import and a
    // name it does not embed is a load error, never a silent fallback.
    const resolver = new PatchResolver(patches ?? {});
    this.insertTempo.setTempo(arrangement.transport.bpm);
    for (const part of arrangement.parts) {
      this.addMusicPart(
        part,
        clonePatch(resolver.require(`part ${part.slot}`, part.preset)),
        part.strip,
      );
    }
    if (master) this.masterStrip!.apply(master);
    this.sidechains.commit(routing);
    if (returns) applyReturnsLive(this.standing().returns, returns);
    // The roster the player reads and — for a live add or removal — grows and
    // shrinks through (#629); the player calls these only after its plan has
    // validated the whole partial, so a refused edit creates and disposes nothing.
    const host: PartHost = {
      get: (slot) => this.musicParts.get(slot),
      add: (part, patch) => this.addMusicPart(part, patch),
      remove: (slot) => this.removeMusicPart(slot),
    };
    this.player = new ArrangementPlayer(
      this.scheduler,
      host,
      arrangement,
      resolver.table(),
      onEvent,
    );
  }

  /**
   * The `music-<slot>` engine part on its strip (#629 decision 1). At init the
   * document's strip is handed in; a part added live starts on the desk's
   * default strip and `apply` then lands the partial's `strip` fields on it,
   * the way it does for every other slot.
   */
  private addMusicPart(part: MusicPart, patch: Patch, strip?: ChannelStrip): AudioPart {
    const audio = this.createMusicPart(
      musicPartName(part.slot),
      patch,
      MUSIC_PART_MAX_VOICES,
      strip,
    );
    this.musicParts.set(part.slot, audio);
    return audio;
  }

  /** Dispose the `music-<slot>` part, its strip and its load meter entry, and nothing else (#629 decision 1). */
  private removeMusicPart(slot: number): void {
    const name = musicPartName(slot);
    this.strips.get(name)?.dispose();
    this.strips.delete(name);
    this.loadMeter.detach(`part:${name}`);
    this.engine.disposePart(name);
    this.musicParts.delete(slot);
  }

  /** Start (or resume) the transport. A no-op while muted or before `initMusic`. */
  startMusic(): void {
    if (!this.player || this.muted) return;
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

  /**
   * ■ (#708, epic #703 decision 8): stop the transport, release everything
   * held, then rewind to tick 0 with every part's region state cleared — the
   * next `startMusic` plays the document from bar 1 exactly as a fresh
   * system would. The mute flag is untouched.
   */
  stopMusic(): void {
    this.scheduler.stop();
    this.player?.releaseAll(this.engine.context.currentTime);
    this.scheduler.reset();
    this.player?.reset();
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
    const routing = this.sidechains.plan(partial);
    if (routing.error) return { ok: false, ignored: [], error: routing.error };
    const { returns, patches, parts, master, ...rest } = partial;
    const { arrangementParts, strips } = splitStrips(parts);
    this.sidechains.begin();
    const result = this.player.apply(
      arrangementParts === undefined
        ? rest
        : { ...rest, parts: arrangementParts as NonNullable<ArrangementPartial['parts']> },
      patches ?? {},
    );
    if (!result.ok) {
      this.sidechains.cancel();
      return result;
    }
    this.insertTempo.setTempo(this.scheduler.bpm);
    const ignored = [...result.ignored];
    if (master !== undefined) ignored.push(...this.masterStrip!.apply(master));
    for (const [slot, strip] of strips) {
      const live = this.strips.get(musicPartName(Number(slot)));
      // An absent slot was already reported by the player's merge.
      if (live) ignored.push(...applyStripLive(live, strip, `parts.${slot}.strip`));
    }
    if (returns !== undefined) ignored.push(...applyReturnsLive(this.standing().returns, returns));
    this.sidechains.commit(routing.graph);
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

  /** A Euclidean part's sounding figure on `slot` (issue #70 capture); null for any other part. */
  capturePattern(slot: number): readonly boolean[] | null {
    return this.player?.capturePattern(slot) ?? null;
  }

  /**
   * The step the part on `slot` is sounding at transport tick `tick`, or -1
   * (#619 decision 2). The console's playhead reads this, so it shows the
   * engine's own position rule instead of re-deriving one.
   */
  stepAt(slot: number, tick: number): number {
    return this.player?.stepAt(slot, tick) ?? -1;
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
   * Driven by the host's timer (the console's `HOST_PUMP_INTERVAL_MS`). Only
   * pumps the look-ahead queue -- the times it emits come from the audio
   * clock, so a late call delays the check, never the note.
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
    this.sidechains.dispose();
    for (const strip of this.strips.values()) strip.dispose();
    this.strips.clear();
    this.musicParts.clear();
    if (this.returns) for (const bus of Object.values(this.returns)) bus.dispose();
    this.masterStrip?.dispose();
    this.masterStripValue = null;
    this.musicBus?.input.disconnect();
    this.musicBus?.filter?.disconnect();
    this.musicBus?.output.disconnect();
    this.auxLevel?.disconnect();
    this.loadMeter.dispose();
    this.engine.dispose();
    this.musicBus = null;
    this.returns = null;
    this.auxLevel = null;
    this.started = false;
  }

  private standing(): { musicBus: AudioBus; returns: Readonly<Record<string, ReturnBus>> } {
    if (!this.musicBus || !this.returns) {
      throw new Error('AudioSystem.init() must be awaited first');
    }
    return { musicBus: this.musicBus, returns: this.returns };
  }

  private auxNode(): GainNode {
    if (!this.auxLevel) throw new Error('AudioSystem.init() must be awaited first');
    return this.auxLevel;
  }

  private route(
    name: string,
    patch: Patch,
    maxVoices: number,
    dry: AudioNode,
    strip?: ChannelStrip,
  ): AudioPart {
    const { returns } = this.standing();
    const seed = this.partSeed?.(name);
    const part = this.engine.createPart(name, {
      patch,
      maxVoices,
      destination: null,
      ...(seed === undefined ? {} : { seed }),
    });
    this.meterLoad(`part:${name}`, part.node);
    this.strips.set(
      name,
      routePart(part, strip ?? stripFor(this.mix, name), returns, dry, this.routeOptions),
    );
    return part;
  }

  /** Turn the audio-load sampler on in one node's processor (#445); `audioLoad.ts` owns the rules. */
  private meterLoad(id: string, node: AudioNode): void {
    meterNode(this.loadMeter, id, node, this.engine.context.sampleRate, AUDIO_LOAD_REPORT_SECONDS);
  }
}
