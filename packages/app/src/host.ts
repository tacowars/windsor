/**
 * The engine host: the one place the console touches Web Audio (#70, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §1).
 *
 * It owns a single `AudioContext` for the life of the page and drives the
 * *real* `AudioSystem` — no graph of its own. The worklet sources are inlined
 * into the page; they become blob URLs handed to `FmEngine.init`, whose
 * default `import.meta.url` path is meaningless in a standalone file.
 *
 * Structural changes (a part slot added or removed, an imported document)
 * rebuild the system on the same context: worklet module maps are per
 * context and keyed by URL, so re-`init` with the same blob URLs resolves
 * from cache instead of re-registering the processors.
 */
import type {
  ApplyResult,
  ArrangementDocument,
  AudioPart,
  DocumentPartial,
  WorkletUrls,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  AudioSystem,
  FmEngine,
  musicPartName,
} from '../../../packages/client/src/audio/index-for-editor';

export type HostLog = (message: string) => void;

export class EngineHost {
  system: AudioSystem | null = null;
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
   * Blob URLs first; a `file://` origin refuses blob worklet modules
   * (observed in the #70 browser verification), so on failure retry once
   * with data URLs on a fresh context — nothing registered on the failed one.
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
    const dsp = window.__A204_DSP__;
    const blob = (source: string): string =>
      URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    const data = (source: string): string =>
      `data:application/javascript;charset=utf-8,${encodeURIComponent(source)}`;
    try {
      await this.start(document, {
        fmUrl: blob(dsp.fm),
        reverbUrl: blob(dsp.reverb),
        compressorUrl: blob(dsp.compressor),
        meterUrl: blob(dsp.meter),
        retroReverbUrl: blob(dsp.retroReverb),
        phaserUrl: blob(dsp.phaser),
        advancedDriveUrl: blob(dsp.advancedDrive),
        delayUrl: blob(dsp.delay),
      });
    } catch {
      try {
        // The latest document, not the captured one: an import or slot toggle
        // may have queued a newer document while the blob attempt was failing,
        // and the retry must not reinstall the older state over it.
        await this.start(this.latest ?? document, {
          fmUrl: data(dsp.fm),
          reverbUrl: data(dsp.reverb),
          compressorUrl: data(dsp.compressor),
          meterUrl: data(dsp.meter),
          retroReverbUrl: data(dsp.retroReverb),
          phaserUrl: data(dsp.phaser),
          advancedDriveUrl: data(dsp.advancedDrive),
          delayUrl: data(dsp.delay),
        });
      } catch (error) {
        this.discard();
        this.log(`audio could not be enabled: ${String(error)} — click the power button to retry`);
        throw error;
      }
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
   * (Re)build the whole system from a document — from tick 0, on the same
   * context. Rebuilds are serialised and coalesced: overlapping calls (rapid
   * slot toggles, an import landing mid-build) queue behind the running one
   * and only the latest document wins, so the live graph cannot end up
   * behind the model (cross-model self-review finding).
   */
  build(document: ArrangementDocument): Promise<void> {
    this.latest = document;
    const generation = ++this.generation;
    this.building = this.building
      .catch(() => undefined)
      .then(() => (generation === this.generation ? this.rebuild(document) : undefined));
    return this.building;
  }

  private async rebuild(document: ArrangementDocument): Promise<void> {
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
    this.system.initMusic(document, (part, tick) =>
      this.log(`${part.name} sounded (slot ${part.slot}, tick ${tick})`),
    );
    // The console's knobs retune the voices already ringing; the game does not.
    engine.setLiveRetune(true);
    if (this.analyser) engine.master.connect(this.analyser);
    await this.system.unlock();
    this.system.startMusic();
  }

  /** Live tuning over the document model; null while audio is not enabled. */
  apply(partial: DocumentPartial): ApplyResult | null {
    return this.system ? this.system.apply(partial) : null;
  }

  capturePattern(slot: number): readonly boolean[] | null {
    return this.system?.capturePattern(slot) ?? null;
  }

  /**
   * The step the part on `slot` sounds at transport tick `tick`, or -1 — the
   * engine's own position rule, which the sequencer cards' playheads read
   * instead of re-deriving one (#619 decision 2).
   */
  stepAt(slot: number, tick: number): number {
    return this.system?.stepAt(slot, tick) ?? -1;
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
