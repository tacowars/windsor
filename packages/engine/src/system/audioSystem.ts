/**
 * The audio system: the one surface the console drives. The console
 * (`packages/app/src/host.ts`) constructs it and pumps `update()` from its
 * frame loop.
 *
 * It composes collaborators that each own their state
 * (docs/log/2026-09-29-audio-system-split.md):
 *
 * - `StandingGraph`: the music bus, the song master, the returns and the aux
 *   fader. Its header draws the signal chain.
 * - `PartStrips`: every part created here, on its strip, by engine name.
 * - `MusicRoster`: the music parts by slot, the player's `PartHost`.
 * - `MusicPlayback`: the player on the transport (start, stop, mute) and the
 *   position queries.
 * - `SystemLoadMeter`: which processors report their load, and the sum.
 *
 * What stays here is construction, the lifecycle (`init`, `update`,
 * `dispose`) and the two document transactions, which span them all.
 *
 * Music comes in as an `ArrangementDocument` (issue #75): the committed JSON,
 * normalised by `makeArrangement`. `initMusic` builds a part per entry in the
 * document's part list — on the patch its `patches` section carries, on the
 * part's own strip — and lands the `returns` overlay on the live return
 * buses; `apply` takes a deep partial of the same document model —
 * arrangement fields through the player, `patches` onto the parts, each
 * part's `strip` and the `returns` onto the live desk (`deskApply.ts`).
 */
import { MUSIC_PART_MAX_VOICES } from '../audioConstants';
import type { AudioLoadReadout } from '../cost/audioLoad';
import { tempoInsertRegistry } from '../inserts/tempoInsertRegistry';
import type { PartStrip, RouteOptions } from '../mixer/channelStrip';
import { applyReturnsLive, applyStripLive } from '../mixer/deskApply';
import { splitStrips } from '../mixer/deskPartial';
import type { MasterStrip } from '../mixer/masterStrip';
import type { ChannelStrip, ReturnSpec } from '../mixer/mix';
import { MIX, RETURNS } from '../mixer/mix';
import { applyMasterLive } from '../mixer/outputStageMaster';
import type { ReturnBus } from '../mixer/returnBus';
import { SidechainDesk } from '../mixer/sidechainDesk';
import type { Patch } from '../patch/patch';
import { clonePatch } from '../patch/patch';
import { Scheduler } from '../sequencing/scheduler';
import type { ArrangementPartial } from '../song/arrangement';
import type { ArrangementDocument, DocumentPartial } from '../song/arrangementDocument';
import type { ApplyResult, MusicEventHandler, RegionStep } from '../song/arrangementPlayer';
import { ArrangementPlayer } from '../song/arrangementPlayer';
import { PatchResolver } from '../song/arrangementValidate';
import type { AudioPart } from '../synth/audioPart';
import { FmEngine } from '../synth/fmEngine';
import type { ScheduledMessage } from '../synth/workletMessages';
import type { PlaybackReadout } from './musicPlayback';
import { MusicPlayback } from './musicPlayback';
import { MusicRoster } from './musicRoster';
import { PartStrips } from './partStrips';
import { StandingGraph } from './standingGraph';
import { SystemLoadMeter } from './systemLoadMeter';

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
  /**
   * The notes each part's processor is built holding, by engine part name
   * (`PartOptions.events`): the offline render's opening (windsor#40). Absent
   * — live playback — every note is posted as it is scheduled.
   */
  partEvents?: (name: string) => ScheduledMessage[] | undefined;
  /**
   * Whether the parts, returns and worklet inserts sample their own timing
   * for the load readout (#445). Defaults to true, as live playback does; the
   * offline song render passes false, since no processor's timing means
   * anything while an export runs (windsor#51).
   */
  meterLoad?: boolean;
}

/** `AudioSystem.readout()` (issue #69): the arrangement's state plus the system's. */
export interface MusicReadout extends PlaybackReadout {
  /** What the DSP costs on the audio thread (#445); all zeros until it reports. */
  load: AudioLoadReadout;
}

export class AudioSystem {
  readonly engine: FmEngine;
  readonly scheduler: Scheduler;

  private readonly meter: SystemLoadMeter;
  private readonly insertTempo: ReturnType<typeof tempoInsertRegistry>;
  private readonly graph: StandingGraph;
  private readonly parts: PartStrips;
  private readonly roster: MusicRoster;
  private readonly sidechains: SidechainDesk;
  private readonly playback: MusicPlayback;
  private started = false;

  constructor(engine?: FmEngine, options: AudioSystemOptions = {}) {
    this.engine = engine ?? new FmEngine();
    this.scheduler = new Scheduler(this.engine.context, { bpm: 96 });
    this.meter = new SystemLoadMeter(this.engine.context, options.meterLoad ?? true);
    this.insertTempo = tempoInsertRegistry(this.scheduler.bpm);
    // Passed to every strip and the song master: how it builds an insert, whom
    // it tells when its chain changes, and how it waits out a fade (#652).
    const routeOptions: RouteOptions = {
      registry: this.meter.registry(this.insertTempo.registry),
      changed: () => this.sidechains.changed(),
      ...(options.defer ? { defer: options.defer } : {}),
    };
    const graph = new StandingGraph(this.engine, options.returns ?? RETURNS, routeOptions);
    const parts = new PartStrips({
      engine: this.engine,
      graph,
      meter: this.meter,
      mix: options.mix ?? MIX,
      routeOptions,
      partSeed: options.partSeed,
      partEvents: options.partEvents,
    });
    const roster = new MusicRoster(parts);
    this.graph = graph;
    this.parts = parts;
    this.roster = roster;
    this.sidechains = new SidechainDesk(
      () => roster.tracks(),
      () => graph.masterStrip,
    );
    this.playback = new MusicPlayback(this.scheduler, this.engine.context);
  }

  /** The song master, distinct from the engine-wide output stage and the channel faders. */
  get masterStrip(): MasterStrip | null {
    return this.graph.masterStrip;
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
    this.graph.build();
    // The plate is a standing processor on the audio thread, so it reports too
    // (#445): a load figure that counted only the parts would understate the
    // music by the whole reverb.
    for (const [name, bus] of Object.entries(this.graph.standing().returns)) {
      this.meter.attach(`return:${name}`, bus.effect);
    }
    // So is the output stage (windsor#93): it runs on every block, song or no song.
    this.meter.attach('outputStage', this.engine.outputStage?.node);
    this.started = true;
  }

  /** Call from a click or key handler. */
  async unlock(): Promise<void> {
    await this.engine.unlock();
  }

  /** Processors this system has turned load reporting on in (#445): parts, worklet returns and inserts, and the output stage. */
  get meteredProcessors(): number {
    return this.meter.processorCount;
  }

  /** Create a part on its strip, dry into the music bus. The patch is the caller's — no name is resolved here (#562). */
  createMusicPart(
    name: string,
    patch: Patch,
    maxVoices = MUSIC_PART_MAX_VOICES,
    strip?: ChannelStrip,
  ): AudioPart {
    return this.parts.createMusic(name, patch, maxVoices, strip);
  }

  /**
   * Create a part on its strip, dry into the aux fader: a sound outside the
   * song, such as an audition or a metronome, that must not pass the song
   * master. The fader is one `GainNode` at unity until `setAuxGain` moves it
   * (#518), so a part's path to the master is otherwise what it always was.
   * The patch is the caller's, as for a music part (#562).
   */
  createAuxPart(name: string, patch: Patch, maxVoices = 8): AudioPart {
    return this.parts.createAux(name, patch, maxVoices);
  }

  /**
   * The music fader (#518 decision 1): the music bus's own output gain, which
   * every music part and both returns pass through. Safe before `init()` —
   * the value is held and applied when the graph is built.
   */
  setMusicGain(gain: number): void {
    this.graph.setMusicGain(gain);
  }

  /** The aux strips' fader. Safe before `init()`, like the music fader. */
  setAuxGain(gain: number): void {
    this.graph.setAuxGain(gain);
  }

  get musicGain(): number {
    return this.graph.musicGain;
  }

  get auxGain(): number {
    return this.graph.auxGain;
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
    if (this.playback.player) return;
    const routing = this.sidechains.check(document);
    this.sidechains.begin();
    const { returns, patches, master, ...arrangement } = document;
    // The document and nothing else (#562): a song carries a snapshot of
    // every patch it plays, so the library is not a runtime import and a
    // name it does not embed is a load error, never a silent fallback.
    const resolver = new PatchResolver(patches ?? {});
    this.insertTempo.setTempo(arrangement.transport.bpm);
    for (const part of arrangement.parts) {
      this.roster.add(
        part,
        clonePatch(resolver.require(`part ${part.slot}`, part.preset)),
        part.strip,
      );
    }
    applyMasterLive(this.masterStrip!, this.engine.outputStage, master);
    this.sidechains.commit(routing);
    if (returns) applyReturnsLive(this.graph.standing().returns, returns);
    this.playback.load(
      new ArrangementPlayer(
        this.scheduler,
        this.roster.host(),
        arrangement,
        resolver.table(),
        onEvent,
      ),
    );
  }

  /** Start (or resume) the transport. A no-op while muted or before `initMusic`. */
  startMusic(): void {
    this.playback.start();
  }

  get musicRunning(): boolean {
    return this.playback.running;
  }

  get isMuted(): boolean {
    return this.playback.isMuted;
  }

  /**
   * Mute stops the transport and releases everything held, so tails ring out
   * rather than cutting; unmute resumes at the tick the transport stopped on
   * (`MusicPlayback.setMuted`).
   */
  setMuted(muted: boolean): void {
    this.playback.setMuted(muted);
  }

  /**
   * ■ (#708, epic #703 decision 8): stop, release, and rewind to tick 0 with
   * the region state cleared (`MusicPlayback.stop`). The mute flag is untouched.
   */
  stopMusic(): void {
    this.playback.stop();
  }

  /**
   * Live tuning over the document model (refinement decision 3; issue #75):
   * merge a partial document over the current state. Arrangement fields go
   * through the player — a merged arrangement that fails validation changes
   * nothing — and a part's `strip` lands on its live strip, only the fields
   * the partial names, with unknown names reported in `ignored` (#597).
   */
  apply(partial: DocumentPartial): ApplyResult {
    const { player } = this.playback;
    if (!player) return { ok: false, ignored: [], error: 'music is not initialised' };
    const routing = this.sidechains.plan(partial);
    if (routing.error) return { ok: false, ignored: [], error: routing.error };
    const { returns, patches, parts, master, ...rest } = partial;
    const { arrangementParts, strips } = splitStrips(parts);
    this.sidechains.begin();
    const result = player.apply(
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
    ignored.push(...applyMasterLive(this.masterStrip!, this.engine.outputStage, master));
    for (const [slot, strip] of strips) {
      const live = this.roster.strip(Number(slot));
      // An absent slot was already reported by the player's merge.
      if (live) ignored.push(...applyStripLive(live, strip, `parts.${slot}.strip`));
    }
    if (returns !== undefined) {
      ignored.push(...applyReturnsLive(this.graph.standing().returns, returns));
    }
    this.sidechains.commit(routing.graph);
    return { ok: true, ignored };
  }

  readout(): MusicReadout {
    return { ...this.playback.readout(), load: this.meter.readout() };
  }

  /**
   * A Euclidean part's sounding figure on `slot` (issue #70 capture): region
   * `regionIndex`'s (windsor#74, windsor#75), or with no index the one
   * `part.sequencer` plays; null for any other part.
   */
  capturePattern(slot: number, regionIndex?: number): readonly boolean[] | null {
    return this.playback.capturePattern(slot, regionIndex);
  }

  /**
   * The step the part on `slot` is sounding at transport tick `tick`, or -1
   * (#619 decision 2). The console's playhead reads this, so it shows the
   * engine's own position rule instead of re-deriving one.
   */
  stepAt(slot: number, tick: number): number {
    return this.playback.stepAt(slot, tick);
  }

  /**
   * Where region `region` of the part on `slot` is at transport tick `tick`,
   * sounding or not (windsor#97): `ArrangementPlayer.regionStepAt`, so a
   * card's playhead outside its region is still the engine's position rule.
   */
  regionStepAt(slot: number, region: number, tick: number): RegionStep | null {
    return this.playback.regionStepAt(slot, region, tick);
  }

  /** The live strip of a part this system created. */
  strip(name: string): PartStrip | undefined {
    return this.parts.get(name);
  }

  /** A return by name, once `init()` has built them. */
  returnBus(name: string): ReturnBus | undefined {
    return this.graph.returnBus(name);
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
    this.playback.dispose();
    this.sidechains.dispose();
    this.parts.dispose();
    this.roster.clear();
    this.graph.dispose();
    this.meter.dispose();
    this.engine.dispose();
    this.started = false;
  }
}
