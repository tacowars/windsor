/**
 * Tape adapter: block controls, stereo audio, shutdown, existing load telemetry and the developer
 * magnetic override (windsor#276), which reaches `TapeMagneticStage.setOverride` from the port, between
 * blocks, and never from `process`.
 */
import {
  TAPE_NAME,
  TAPE_BOUNDS,
  TAPE_DEFAULTS,
  TAPE_OVERSAMPLING,
  TAPE_TYPES,
} from '../../inserts/tapeConstants';
import {
  TAPE_MAGNETIC_OVERRIDE,
  type TapeMagneticOverrideMessage,
} from '../../inserts/tapeMagneticOverrideMessage';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { TapeDsp } from './tapeDsp';
import type { TapeParams } from './tapeDsp';

class TapeProcessor extends AudioWorkletProcessor {
  dsp: TapeDsp;
  running: boolean;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries(TAPE_BOUNDS).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: TAPE_DEFAULTS[name as keyof typeof TAPE_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      {
        name: 'model',
        minValue: 0,
        maxValue: TAPE_TYPES.length - 1,
        defaultValue: 0,
        automationRate: 'k-rate',
      },
      { name: 'split', minValue: 0, maxValue: 1, defaultValue: 0, automationRate: 'k-rate' },
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
      {
        name: 'oversampling',
        minValue: TAPE_OVERSAMPLING[0],
        maxValue: TAPE_OVERSAMPLING[TAPE_OVERSAMPLING.length - 1],
        defaultValue: TAPE_DEFAULTS.oversampling,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: TapeParams = {};
    for (const descriptor of TapeProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    this.dsp = new TapeDsp(sampleRate, params);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({
      data,
    }: MessageEvent<{ type: 'stop' } | ReportLoadMessage | TapeMagneticOverrideMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
      if (data.type === TAPE_MAGNETIC_OVERRIDE) this.dsp.magnetic.setOverride(data.row);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: TapeParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    const frames = out[0].length;
    const dsp = this.dsp,
      frame = dsp.input;
    dsp.configure(params, frames);
    // Each sample reaches the DSP in its `input` slots, never as an argument (worklet rule 2). An
    // absent channel is tested apart from the read: `left?.[i]`, a sample or undefined, is a value V8
    // can only hold boxed, a new heap number per sample even when it is stored straight to a slot.
    for (let i = 0; i < frames; i++) {
      frame[0] = left === undefined ? 0 : (left[i] ?? 0);
      frame[1] = right === undefined ? 0 : (right[i] ?? 0);
      dsp.step();
      out[0][i] = dsp.left;
      if (out[1]) out[1][i] = dsp.right;
    }
    this.load.end(frames);
    return true;
  }
}

registerProcessor(TAPE_NAME, TapeProcessor);
