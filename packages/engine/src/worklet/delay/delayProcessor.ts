/**
 * Delay adapter: block controls, stereo audio, shutdown and existing load telemetry.
 * An asleep block (windsor#793, `delayDsp.ts`) is `rest`, outside the awake loop.
 */
import {
  DELAY_NAME,
  DELAY_BOUNDS,
  DELAY_DEFAULTS,
  DELAY_DSP,
  DELAY_SLEEP,
} from '../../inserts/delayConstants';
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
    // `sleep: false` is a test's, to prove the renders with and without it agree.
    this.dsp = new DelayDsp(sampleRate, params, options.processorOptions?.sleep !== false);
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
    const dsp = this.dsp;
    dsp.configure(params, frames, dsp.sleepEnabled && this.silent(left, right));
    if (dsp.asleep) this.rest(out);
    else this.render(left, right, out, frames);
    this.load.end(frames);
    return true;
  }

  /**
   * One awake block, in a method of its own as the plate's `_renderBlock` is (windsor#793): V8
   * optimises it on sound alone, never inside a `process` that has so far only slept.
   */
  render(
    left: Float32Array | undefined,
    right: Float32Array | undefined,
    out: Float32Array[],
    frames: number,
  ): void {
    // `left?.[i] ?? 0` would read the same, but its load may be undefined, so V8
    // keeps it tagged and boxes every sample; a bounded load stays a double.
    const leftFrames = left ? left.length : 0,
      rightFrames = right ? right.length : 0;
    const dsp = this.dsp;
    for (let i = 0; i < frames; i++) {
      // Through fields, not arguments, which V8 boxes across a call it does not inline.
      dsp.inputLeft = i < leftFrames ? left![i] : 0;
      dsp.inputRight = i < rightFrames ? right![i] : 0;
      dsp.tick();
      out[0][i] = dsp.left;
      if (out[1]) out[1][i] = dsp.right;
    }
  }

  /** Every sample of the block within the sleep floor; an absent channel is silent. */
  silent(left: Float32Array | undefined, right: Float32Array | undefined): boolean {
    const floor = DELAY_SLEEP.inputFloor;
    if (left) for (let i = 0; i < left.length; i++) if (Math.abs(left[i]) > floor) return false;
    if (right && right !== left)
      for (let i = 0; i < right.length; i++) if (Math.abs(right[i]) > floor) return false;
    return true;
  }

  /** One asleep block: zeros, the input's silence to within its floor. */
  rest(out: Float32Array[]): void {
    out[0].fill(0);
    if (out[1]) out[1].fill(0);
  }
}

registerProcessor(DELAY_NAME, DelayProcessor);
