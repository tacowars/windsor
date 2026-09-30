/**
 * The Parametric EQ's worklet adapter (windsor#198), bundled to
 * `generated/eq-processor.js`: the k-rate AudioParams (flat names from
 * `inserts/eqParameters.ts`), the port's stop and load reports, and one call
 * into `EqDsp` per render quantum. A mono input feeds both channels; a
 * missing input is silence.
 *
 * Invariants: `process` allocates nothing (the parameter names are built
 * once, in the constructor); every value is held in its range before the DSP
 * reads it. Pinned by `inserts/eqDsp.test.ts` through this bundle.
 */
import {
  EQ_BAND_COUNT,
  EQ_BAND_TYPES,
  EQ_BOUNDS,
  EQ_DSP,
  EQ_NAME,
  EQ_SLOPES,
} from '../../inserts/eqConstants';
import { eqBandGain } from '../../inserts/eqCoefficients';
import { EQ_BAND_PARAMS, eqParamName, eqParameterDescriptors } from '../../inserts/eqParameters';
import type { LoadReportMessage, ReportLoadMessage } from '../../synth/workletMessages';
import { EqDsp } from './eqDsp';

type EqParams = Record<string, Float32Array>;

const FIELDS = EQ_BAND_PARAMS.length;
/** Each field's offset within a band's run of names. */
const F = {
  freq: EQ_BAND_PARAMS.indexOf('Freq'),
  gain: EQ_BAND_PARAMS.indexOf('Gain'),
  q: EQ_BAND_PARAMS.indexOf('Q'),
  type: EQ_BAND_PARAMS.indexOf('Type'),
  slope: EQ_BAND_PARAMS.indexOf('Slope'),
  on: EQ_BAND_PARAMS.indexOf('On'),
};
const TYPE_IDS = [0, EQ_BAND_TYPES.length - 1];
const SLOPE_IDS = [0, EQ_SLOPES.length - 1];

function clamp(value: number, range: readonly number[]): number {
  return value < range[0] ? range[0] : value > range[1] ? range[1] : value;
}

class EqProcessor extends AudioWorkletProcessor {
  dsp: EqDsp;
  running: boolean;
  silence: Float32Array;
  /** `b1Freq` … `b8On`, in `EQ_BAND_PARAMS` order band by band. */
  names: string[];
  loadQuanta: number;
  load: LoadReportMessage;
  wallStart: number;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return eqParameterDescriptors();
  }

  constructor() {
    super();
    this.dsp = new EqDsp(sampleRate, EQ_BAND_COUNT);
    this.running = true;
    this.silence = new Float32Array(EQ_DSP.maxQuantumFrames);
    this.names = [];
    for (let b = 0; b < EQ_BAND_COUNT; b++)
      for (const field of EQ_BAND_PARAMS) this.names.push(eqParamName(b, field));
    this.loadQuanta = 0;
    // The times are readings of Date.now() and differences of them: doubles from
    // their first write (worklet rule 7), set by `reportLoad` or before each post.
    this.load = { type: 'load', busyMs: NaN, wallMs: NaN, quanta: 0, peakMs: NaN, underruns: 0 };
    this.wallStart = NaN;
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') {
        this.loadQuanta = Math.max(0, data.quanta | 0);
        this.load.busyMs = this.load.quanta = this.load.peakMs = 0;
        this.wallStart = Date.now();
      }
    };
  }

  /** Read every parameter into the DSP's `next*` values, then let it retarget. */
  configure(params: EqParams): void {
    const dsp = this.dsp;
    const names = this.names;
    const scale = clamp(params.scale[0], EQ_BOUNDS.scale);
    for (let b = 0; b < EQ_BAND_COUNT; b++) {
      const band = dsp.bands[b];
      const at = b * FIELDS;
      band.nextFreq = clamp(params[names[at + F.freq]][0], EQ_BOUNDS.freq);
      band.nextQ = clamp(params[names[at + F.q]][0], EQ_BOUNDS.q);
      band.nextType = clamp(Math.round(params[names[at + F.type]][0]), TYPE_IDS);
      band.nextSlope = EQ_SLOPES[clamp(Math.round(params[names[at + F.slope]][0]), SLOPE_IDS)];
      band.nextOn = params[names[at + F.on]][0] >= EQ_DSP.switchThreshold;
      const gain = clamp(params[names[at + F.gain]][0], EQ_BOUNDS.gain);
      band.nextGain = eqBandGain(band.nextType, gain, scale);
    }
    dsp.nextOutput = clamp(params.output[0], EQ_BOUNDS.output);
    dsp.nextEnabled = params.enabled[0] >= EQ_DSP.switchThreshold;
    dsp.retarget();
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: EqParams): boolean {
    if (!this.running) return false;
    const start = this.loadQuanta ? Date.now() : 0;
    const out = outputs[0];
    if (!out || !out[0] || !out[1]) return true;
    const input = inputs[0];
    const left = input && input[0] ? input[0] : this.silence;
    const right = input && input[1] ? input[1] : left;
    this.configure(params);
    this.dsp.process(left, right, out[0], out[1]);
    if (this.loadQuanta) this.report(out[0].length, start);
    return true;
  }

  report(frames: number, start: number): void {
    const now = Date.now();
    const elapsed = now - start;
    const load = this.load;
    load.busyMs += elapsed;
    load.peakMs = Math.max(load.peakMs, elapsed);
    if (elapsed - 1 >= (frames / sampleRate) * EQ_DSP.millisecondsPerSecond) load.underruns++;
    if (++load.quanta < this.loadQuanta) return;
    load.wallMs = now - this.wallStart;
    this.port.postMessage(load);
    load.busyMs = load.quanta = load.peakMs = 0;
    this.wallStart = now;
  }
}

registerProcessor(EQ_NAME, EqProcessor);
