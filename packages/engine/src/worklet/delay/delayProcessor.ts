/** Delay adapter: block controls, stereo audio, shutdown and existing load telemetry. */
import { DELAY_NAME, DELAY_BOUNDS, DELAY_DEFAULTS, DELAY_DSP } from '../../inserts/delayConstants';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { DelayDsp } from './delayDsp';
import type { DelayParams } from './delayDsp';

class DelayProcessor extends AudioWorkletProcessor {
  dsp: DelayDsp;
  running: boolean;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries({
        ...DELAY_BOUNDS,
        leftMs: [1, DELAY_DSP.maxSeconds * DELAY_DSP.milliseconds],
        rightMs: [1, DELAY_DSP.maxSeconds * DELAY_DSP.milliseconds],
      }).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: DELAY_DEFAULTS[name as keyof typeof DELAY_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      { name: 'mode', minValue: 0, maxValue: 2, defaultValue: 0, automationRate: 'k-rate' },
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: DelayParams = {};
    for (const descriptor of DelayProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    this.dsp = new DelayDsp(sampleRate, params);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: DelayParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    const frames = out[0].length;
    // `left?.[i] ?? 0` would read the same, but its load may be undefined, so V8
    // keeps it tagged and boxes every sample; a bounded load stays a double.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const dsp = this.dsp;
    dsp.configure(params, frames);
    for (let i = 0; i < frames; i++) {
      // Through fields, not arguments, which V8 boxes across a call it does not inline.
      dsp.inputLeft = i < leftFrames ? left![i] : 0;
      dsp.inputRight = i < rightFrames ? right![i] : 0;
      dsp.tick();
      out[0][i] = dsp.left;
      if (out[1]) out[1][i] = dsp.right;
    }
    this.load.end(frames);
    return true;
  }
}

registerProcessor(DELAY_NAME, DelayProcessor);
