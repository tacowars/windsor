/**
 * The output stage's worklet adapter (windsor#93). The DSP is
 * `mixer/outputStageDsp.ts`; this owns the parameters, the port and the
 * report. The mode, ceiling and lookahead are k-rate parameters, so a value
 * set before an offline render starts is heard from its first frame, which a
 * port message would not be. The report is one reused object, posted at
 * `OUTPUT_STAGE_REPORT_HZ` for as long as the context runs; `process`
 * allocates nothing. `mixer/outputStageProcessor.test.ts` runs the generated
 * bundle and `mixer/outputStageGolden.test.ts` pins its render.
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
  OUTPUT_STAGE_QUANTUM,
  OUTPUT_STAGE_REPORT_HZ,
  silentReport,
} from '../../mixer/outputStageConstants';
import type { OutputStageReport } from '../../mixer/outputStageConstants';
import { OutputStageDsp } from '../../mixer/outputStageDsp';

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
  declare silence: Float32Array;

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
    this.silence = new Float32Array(OUTPUT_STAGE_QUANTUM);
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' }>) => {
      if (data.type === 'stop') this.running = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params): boolean {
    if (!this.running) return false;
    const out = outputs[0];
    const outL = out?.[0];
    if (!out || !outL) return true;
    const outR = out[1] ?? outL;
    const frames = outL.length;
    // Grown once if a platform ever renders a longer quantum; never per block.
    if (this.silence.length < frames) this.silence = new Float32Array(frames);
    const inL = inputs[0]?.[0] ?? this.silence;
    const inR = inputs[0]?.[1] ?? inL;
    const mode = Math.round(params['mode']![0]!);
    this.dsp.configure(mode, params['ceilingDb']![0]!, params['lookahead']![0]! >= 1 / 2);
    this.dsp.process(inL, inR, outL, outR, frames);
    this.frames += frames;
    if (this.frames >= sampleRate / OUTPUT_STAGE_REPORT_HZ) {
      this.dsp.takeReport(this.report);
      this.port.postMessage(this.report);
      this.frames = 0;
    }
    return true;
  }
}

registerProcessor(OUTPUT_STAGE_NAME, OutputStageProcessor);
