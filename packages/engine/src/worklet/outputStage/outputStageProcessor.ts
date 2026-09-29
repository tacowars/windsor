/**
 * The output stage's worklet adapter (windsor#93). The DSP is
 * `mixer/outputStageDsp.ts`; this owns the parameters, the port and the
 * report. The mode, ceiling and lookahead are k-rate parameters, so a value
 * set before an offline render starts is heard from its first frame, which a
 * port message would not be. The report is one reused object, posted at
 * `OUTPUT_STAGE_REPORT_HZ` for as long as the context runs; `process`
 * allocates nothing. Like the other DSP processors it also times its own
 * `process()` once a `reportLoad` message turns the sampler on, and posts a
 * reused `load` report for `cost/audioLoad.ts` (#445); both reports share the
 * port, told apart by `type`. `mixer/outputStageProcessor.test.ts` runs the
 * generated bundle and `mixer/outputStageGolden.test.ts` pins its render.
 *
 * Unlike the other worklet folders, this one has no `tsconfig.json` of its
 * own: it compiles in the engine's project, under its stricter flags, with
 * the worklet-scope names it reads declared below. Its class fields are
 * `declare`d, so they emit nothing whatever the class-field semantics.
 */
import {
  OUTPUT_CEILING_DB,
  OUTPUT_STAGE_DEFAULTS,
  OUTPUT_STAGE_MODES,
  OUTPUT_STAGE_NAME,
  OUTPUT_STAGE_REPORT_HZ,
  MS_PER_SECOND,
  silentReport,
} from '../../mixer/outputStageConstants';
import type { OutputStageReport } from '../../mixer/outputStageConstants';
import { OutputStageDsp } from '../../mixer/outputStageDsp';
import type { LoadReportMessage, ReportLoadMessage } from '../../synth/workletMessages';

type ControlMessage = { type: 'stop' } | ReportLoadMessage;

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

type Params = Record<string, Float32Array>;
interface ParamDescriptor {
  name: string;
  minValue: number;
  maxValue: number;
  defaultValue: number;
  automationRate: 'k-rate';
}

class OutputStageProcessor extends AudioWorkletProcessor {
  declare dsp: OutputStageDsp;
  declare running: boolean;
  declare frames: number;
  declare report: OutputStageReport;
  declare loadQuanta: number;
  declare load: LoadReportMessage;
  declare wallStart: number;

  static get parameterDescriptors(): ParamDescriptor[] {
    return [
      {
        name: 'mode',
        minValue: 0,
        maxValue: OUTPUT_STAGE_MODES.length - 1,
        defaultValue: OUTPUT_STAGE_MODES.indexOf(OUTPUT_STAGE_DEFAULTS.mode),
        automationRate: 'k-rate',
      },
      {
        name: 'ceilingDb',
        minValue: OUTPUT_CEILING_DB.min,
        maxValue: OUTPUT_CEILING_DB.max,
        defaultValue: OUTPUT_STAGE_DEFAULTS.ceilingDb,
        automationRate: 'k-rate',
      },
      {
        name: 'lookahead',
        minValue: 0,
        maxValue: 1,
        defaultValue: OUTPUT_STAGE_DEFAULTS.lookahead ? 1 : 0,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();
    this.dsp = new OutputStageDsp(sampleRate);
    this.running = true;
    this.frames = 0;
    this.report = silentReport();
    this.loadQuanta = 0;
    this.load = { type: 'load', busyMs: 0, wallMs: 0, quanta: 0, peakMs: 0, underruns: 0 };
    this.wallStart = 0;
    this.port.onmessage = ({ data }: MessageEvent<ControlMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') {
        this.loadQuanta = Math.max(0, data.quanta | 0);
        this.load.busyMs = this.load.quanta = this.load.peakMs = 0;
        this.wallStart = Date.now();
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params): boolean {
    if (!this.running) return false;
    const start = this.loadQuanta ? Date.now() : 0;
    const out = outputs[0];
    const outL = out?.[0];
    if (!out || !outL) return true;
    const outR = out[1] ?? outL;
    const frames = outL.length;
    let inL = inputs[0]?.[0];
    let inR = inputs[0]?.[1] ?? inL;
    if (!inL || !inR) {
      // A missing input is silence, processed in place in the output, so a
      // quantum of any length needs no buffer (the DSP reads each sample
      // before it writes it). The output is always stereo (`outputStage.ts`).
      outL.fill(0);
      outR.fill(0);
      inL = outL;
      inR = outR;
    }
    const mode = Math.round(params['mode']![0]!);
    this.dsp.configure(mode, params['ceilingDb']![0]!, params['lookahead']![0]! >= 1 / 2);
    this.dsp.process(inL, inR, outL, outR, frames);
    this.frames += frames;
    if (this.frames >= sampleRate / OUTPUT_STAGE_REPORT_HZ) {
      this.dsp.takeReport(this.report);
      this.port.postMessage(this.report);
      this.frames = 0;
    }
    if (this.loadQuanta) this.sampleLoad(frames, start);
    return true;
  }

  /**
   * The load sampler (#445), as the compressor's: the `Date.now()` span of
   * this call, summed, and posted every `loadQuanta` calls in the one reused
   * object. `cost/audioLoad.ts` says what the numbers are worth.
   */
  sampleLoad(frames: number, start: number): void {
    const now = Date.now();
    const elapsed = now - start;
    const load = this.load;
    load.busyMs += elapsed;
    load.peakMs = Math.max(load.peakMs, elapsed);
    if (elapsed - 1 >= (frames / sampleRate) * MS_PER_SECOND) load.underruns++;
    if (++load.quanta < this.loadQuanta) return;
    load.wallMs = now - this.wallStart;
    this.port.postMessage(load);
    load.busyMs = load.quanta = load.peakMs = 0;
    this.wallStart = now;
  }
}

registerProcessor(OUTPUT_STAGE_NAME, OutputStageProcessor);
