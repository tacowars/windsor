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
  DeepPartial,
  MusicPartId,
  NotePattern,
  WorkletUrls,
} from '../../../packages/client/src/audio/index-for-editor';
import { AudioSystem, FmEngine } from '../../../packages/client/src/audio/index-for-editor';

export type HostLog = (message: string) => void;

export class EngineHost {
  system: AudioSystem | null = null;
  /** Scope tap on the engine master. Visualisation only; routes nothing. */
  analyser: AnalyserNode | null = null;

  private context: AudioContext | null = null;
  private urls: WorkletUrls | null = null;
  private readonly log: HostLog;

  constructor(log: HostLog) {
    this.log = log;
  }

  get enabled(): boolean {
    return this.system !== null;
  }

  /** First user gesture: create the context, load the DSP, build the system. */
  async enable(document: ArrangementDocument): Promise<void> {
    if (this.context) {
      await this.system?.unlock();
      return;
    }
    const dsp = window.__A204_DSP__;
    const blob = (source: string): string =>
      URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
    this.context = new AudioContext({ latencyHint: 'interactive' });
    // Created once and kept: the same URLs let a rebuilt engine re-init from
    // the context's worklet module cache without re-registering processors.
    this.urls = { fmUrl: blob(dsp.fm), reverbUrl: blob(dsp.reverb) };
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    await this.build(document);
  }

  /** (Re)build the whole system from a document. From tick 0, same context. */
  async build(document: ArrangementDocument): Promise<void> {
    if (!this.context || !this.urls) return;
    this.system?.dispose();
    const engine = new FmEngine(this.context);
    await engine.init(this.urls);
    this.system = new AudioSystem(engine);
    await this.system.init();
    this.system.initMusic(document, (part, tick) => this.log(`${part} sounded (tick ${tick})`));
    if (this.analyser) engine.master.connect(this.analyser);
    await this.system.unlock();
    this.system.startMusic();
  }

  /** Live tuning over the document model; null while audio is not enabled. */
  apply(partial: DeepPartial<ArrangementDocument>): ApplyResult | null {
    return this.system ? this.system.apply(partial) : null;
  }

  capturePattern(id: MusicPartId): readonly boolean[] | NotePattern | null {
    return this.system?.capturePattern(id) ?? null;
  }

  /** The engine part behind a strip name, for the Parts tab and keyboard. */
  part(name: string): AudioPart | null {
    return this.system?.engine.getPart(name) ?? null;
  }

  /** Pump the look-ahead scheduler; driven by the page's interval timer. */
  update(): void {
    this.system?.update(0);
  }
}
