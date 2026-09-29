/**
 * The engine host: the one place the console touches Web Audio (#70, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §1).
 *
 * It owns a single `AudioContext` for the life of the page and drives the
 * *real* `AudioSystem` — no graph of its own. The worklet modules load from
 * the engine's default URLs, resolved by Vite from `import.meta.url`.
 *
 * Structural changes (a part slot added or removed, an imported document)
 * rebuild the system on the same context: worklet module maps are per
 * context and keyed by URL, so re-`init` with the same URLs resolves
 * from cache instead of re-registering the processors.
 */
import type {
  ApplyResult,
  ArrangementDocument,
  AudioPart,
  DocumentPartial,
  RegionStep,
  WorkletUrls,
} from '@windsor/engine';
import { AudioSystem, FmEngine, TICKS_PER_BAR, musicPartName, songTicksOf } from '@windsor/engine';

import type { ConsoleTransport } from './context';
import { nextTransportState, type TransportState } from './transportModel';

export type HostLog = (message: string) => void;

/** What a rebuild may carry beyond its document. */
export interface BuildOptions {
  /**
   * The song tick the transport was at (windsor#132): a system built while
   * ▶ is pressed starts from the top of that bar instead of tick 0. Only the
   * undo and redo rebuild passes it; every other build starts from the top.
   */
  resumeAt?: number;
}

/**
 * Where a rebuilt system starts (windsor#132 decisions 2 and 3): the start of
 * the bar holding `resumeAt`, or the top of the song when there is none or
 * that bar is past the end of the song being built.
 */
export function resumeTick(resumeAt: number | undefined, songTicks: number): number {
  if (resumeAt === undefined || !(resumeAt > 0)) return 0;
  const bar = Math.floor(resumeAt / TICKS_PER_BAR) * TICKS_PER_BAR;
  return bar < songTicks ? bar : 0;
}

/** The slice of the system ▶ ■ ‖ drive; a test fakes this much. */
export type TransportSystem = Pick<
  AudioSystem,
  'startMusic' | 'stopMusic' | 'seekMusic' | 'setMuted' | 'musicRunning' | 'scheduler' | 'engine'
>;

/**
 * The console's transport (#708, epic #703 decision 8) over whatever system
 * is live: ▶ unmutes and starts from the current tick; ‖ is `setMuted(true)`
 * (stop + release, the tick kept); ■ is `stopMusic` (stop + release + rewind
 * to tick 0 with the region state cleared). The state outlives a rebuild:
 * a system built while playing starts at once, otherwise it waits idle at
 * tick 0 for ▶ — the power button included.
 */
export class HostTransport implements ConsoleTransport {
  private current: TransportState = 'idle';
  /** Where the build in flight will start (windsor#132): what `position()` reads while no system is live. */
  private pending = 0;

  constructor(private readonly live: () => TransportSystem | null) {}

  get state(): TransportState {
    return this.current;
  }

  get running(): boolean {
    return this.live()?.musicRunning ?? false;
  }

  play(): boolean {
    const system = this.live();
    if (!system) return false;
    system.setMuted(false);
    system.startMusic();
    this.current = nextTransportState(this.current, 'play');
    return true;
  }

  /** A pause landing mid-rebuild (no system yet) still counts: the new system is adopted idle. */
  pause(): void {
    if (this.current !== 'playing') return;
    this.live()?.setMuted(true);
    this.current = nextTransportState(this.current, 'pause');
  }

  stop(): void {
    this.live()?.stopMusic();
    this.current = nextTransportState(this.current, 'stop');
  }

  /**
   * Move the stopped or paused transport to `tick` (windsor#102, the Song
   * view's playhead drag): the engine's seek, so ▶ plays from there and
   * `position()` reads it at once. The state is kept, so a paused transport
   * stays paused. False, changing nothing, while playing or before audio.
   */
  seek(tick: number): boolean {
    return this.live()?.seekMusic(tick) ?? false;
  }

  /**
   * The audible transport tick: the console's one reading of position (#619,
   * #705). While no system is live it is the tick the pending build will
   * start from (windsor#132), so a second undo landing mid-rebuild carries the
   * first one's bar forward instead of 0; before audio that is 0.
   */
  position(): number {
    const system = this.live();
    return system ? system.scheduler.audibleTick(system.engine.context.currentTime) : this.pending;
  }

  /** A build was queued that will start the song at `tick` (windsor#132). */
  buildPending(tick: number): void {
    this.pending = tick;
  }

  /**
   * A freshly built system sits at tick 0: start it if ▶ is pressed, from
   * `from` through the engine's seek (windsor#132), else the transport is idle.
   */
  adopt(system: TransportSystem, from = 0): void {
    if (this.current !== 'playing') {
      this.current = 'idle';
      return;
    }
    if (from > 0) system.seekMusic(from);
    system.startMusic();
  }
}

export class EngineHost {
  system: AudioSystem | null = null;
  /** ▶ ■ ‖ over the live system; `ctx.transport` (#708). */
  readonly transport = new HostTransport(() => this.system);
  /** Scope tap on the engine master. Visualisation only; routes nothing. */
  analyser: AnalyserNode | null = null;

  private context: AudioContext | null = null;
  private urls: WorkletUrls | null = null;
  private building: Promise<void> = Promise.resolve();
  private generation = 0;
  /** The most recent document handed to build(); what a retry must install. */
  private latest: ArrangementDocument | null = null;
  private readonly log: HostLog;

  constructor(log: HostLog) {
    this.log = log;
  }

  get enabled(): boolean {
    return this.system !== null;
  }

  /** A build is in flight: the context exists and the system it will install does not yet (#629). */
  get isBuilding(): boolean {
    return this.context !== null && this.system === null;
  }

  /**
   * First user gesture: create the context, load the DSP, build the system.
   * The worklet modules load from the engine's own URLs (`workletMessages.ts`),
   * which Vite serves in development and emits as hashed assets in `dist/`.
   *
   * The early return is on the *system*, not the context (#617). `start` sets
   * the context before it builds, so a run where both attempts threw left a
   * context behind with `system === null`, and every later click on the power
   * button took the early return and awaited `undefined` — a dead button with
   * no audio and no error. Now a failed enable tears the context back down,
   * says so, and rethrows, so the next click is a real retry.
   */
  async enable(document: ArrangementDocument): Promise<void> {
    if (this.system) {
      await this.system.unlock();
      return;
    }
    // `system` is also null for as long as a build runs — the first enable,
    // and the moment `rebuild` swaps it — so a click landing in that window
    // joins the build in flight instead of opening a second context over it.
    if (this.context) return this.joinBuild();
    try {
      await this.start(document, {});
    } catch (error) {
      this.discard();
      this.log(`audio could not be enabled: ${String(error)} — click the power button to retry`);
      throw error;
    }
  }

  /** Wait for the build already in flight, then unlock whatever it produced. */
  private async joinBuild(): Promise<void> {
    await this.building.catch(() => undefined);
    await this.system?.unlock();
  }

  /** Back to the state before the first gesture, so the next click starts clean. */
  private discard(): void {
    this.system?.dispose();
    this.system = null;
    this.analyser = null;
    this.urls = null;
    void this.context?.close();
    this.context = null;
  }

  /** One attempt: a fresh context and the given module URLs, kept on success.
   * The same URLs let a rebuilt engine re-init from the context's worklet
   * module cache without re-registering the processors. */
  private async start(document: ArrangementDocument, urls: WorkletUrls): Promise<void> {
    void this.context?.close();
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.urls = urls;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    await this.build(document);
  }

  /**
   * (Re)build the whole system from a document — at tick 0, or at the bar
   * `options.resumeAt` names (windsor#132), on the same context, playing
   * only if ▶ is pressed (#708). Rebuilds are serialised and coalesced: overlapping calls (rapid
   * slot toggles, an import landing mid-build) queue behind the running one
   * and only the latest document wins, so the live graph cannot end up
   * behind the model (cross-model self-review finding). The latest call's
   * options win with its document, so an import queued behind an undo
   * starts from the top, and the transport reads the latest call's start
   * tick until the system stands.
   */
  build(document: ArrangementDocument, options: BuildOptions = {}): Promise<void> {
    this.latest = document;
    const generation = ++this.generation;
    const from = resumeTick(options.resumeAt, songTicksOf(document));
    this.transport.buildPending(from);
    this.building = this.building
      .catch(() => undefined)
      .then(() => (generation === this.generation ? this.rebuild(document, from) : undefined));
    return this.building;
  }

  private async rebuild(document: ArrangementDocument, from: number): Promise<void> {
    if (!this.context || !this.urls) return;
    // Dropped as it is disposed (#617): `init` below can throw — a worklet
    // module that will not load on this origin — and `apply`, `capturePattern`
    // and `part` would otherwise go on calling into a disposed system.
    this.system?.dispose();
    this.system = null;
    const engine = new FmEngine(this.context);
    await engine.init(this.urls);
    this.system = new AudioSystem(engine);
    await this.system.init();
    this.system.initMusic(document);
    // The console's knobs retune the voices already ringing (off by default in the engine).
    engine.setLiveRetune(true);
    if (this.analyser) engine.master.connect(this.analyser);
    await this.system.unlock();
    this.transport.adopt(this.system, from);
  }

  /** Live tuning over the document model; null while audio is not enabled. */
  apply(partial: DocumentPartial): ApplyResult | null {
    return this.system ? this.system.apply(partial) : null;
  }

  /** A Euclidean part's live figure: region `region`'s (windsor#75), or with none the part's own. */
  capturePattern(slot: number, region?: number): readonly boolean[] | null {
    return this.system?.capturePattern(slot, region) ?? null;
  }

  /**
   * The step the part on `slot` sounds at transport tick `tick`, or -1 — the
   * engine's own position rule, which the sequencer cards' playheads read
   * instead of re-deriving one (#619 decision 2).
   */
  stepAt(slot: number, tick: number): number {
    return this.system?.stepAt(slot, tick) ?? -1;
  }

  /**
   * Where region `region` of the part on `slot` is at transport tick `tick`,
   * sounding or not, or null — the engine's rule, which the grid card's
   * bright and ghost playhead read (windsor#97).
   */
  regionStepAt(slot: number, region: number, tick: number): RegionStep | null {
    return this.system?.regionStepAt(slot, region, tick) ?? null;
  }

  /** The engine part on a slot, for the Parts tab and keyboard (#597: never by label). */
  part(slot: number): AudioPart | null {
    return this.system?.engine.getPart(musicPartName(slot)) ?? null;
  }

  /** Pump the look-ahead scheduler; driven by the page's interval timer. */
  update(): void {
    this.system?.update(0);
  }
}
