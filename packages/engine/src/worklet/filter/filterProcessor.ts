/**
 * The Filter insert's adapter (windsor#622): its params, stereo audio in
 * blocks through `FilterDsp`, shutdown and the load telemetry every
 * processor reports. Cutoff, Reso and Mix are k-rate params a lane may
 * hold; `mode` (an index into `FILTER_MODES`), `slope24` and `enabled` are
 * written by the stage alone. The render allocates nothing: see
 * `filterDsp.ts`.
 */
import {
  FILTER_BOUNDS,
  FILTER_DEFAULTS,
  FILTER_DSP,
  FILTER_MODES,
  FILTER_NAME,
} from '../../inserts/filterConstants';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { FilterDsp } from './filterDsp';
import type { FilterParams } from './filterDsp';

class FilterProcessor extends AudioWorkletProcessor {
  dsp: FilterDsp;
  running: boolean;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries(FILTER_BOUNDS).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: FILTER_DEFAULTS[name as keyof typeof FILTER_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      {
        name: 'mode',
        minValue: 0,
        maxValue: FILTER_MODES.length - 1,
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      { name: 'slope24', minValue: 0, maxValue: 1, defaultValue: 0, automationRate: 'k-rate' },
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: FilterParams = {};
    for (const descriptor of FilterProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    this.dsp = new FilterDsp(sampleRate, params);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: FilterParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    const outLeft = out[0],
      outRight = out[1];
    const frames = outLeft.length;
    // `left?.[i] ?? 0` would read the same, but its load may be undefined, so V8
    // keeps it tagged and boxes every sample; a bounded load stays a double.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const dsp = this.dsp;
    const inL = dsp.input[0],
      inR = dsp.input[1],
      outL = dsp.output[0],
      outR = dsp.output[1];
    dsp.configure(params);
    const block = FILTER_DSP.blockFrames;
    for (let at = 0; at < frames; at += block) {
      const n = frames - at < block ? frames - at : block;
      for (let s = 0; s < n; s++) {
        const i = at + s;
        inL[s] = i < leftFrames ? left![i] : 0;
        inR[s] = i < rightFrames ? right![i] : 0;
      }
      dsp.render(n);
      for (let s = 0; s < n; s++) {
        outLeft[at + s] = outL[s];
        if (outRight) outRight[at + s] = outR[s];
      }
    }
    this.load.end(frames);
    return true;
  }
}

registerProcessor(FILTER_NAME, FilterProcessor);
