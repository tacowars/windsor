/** Phaser adapter: block controls, stereo audio, shutdown and existing load telemetry.
 * Its render allocates nothing (windsor#231): see phaserDsp.ts. An asleep block
 * (windsor#793) is `rest`, a method of its own outside the awake loop, as the
 * plate's is, so V8 keeps that loop optimised for sound.
 */
import {
  PHASER_NAME,
  PHASER_BOUNDS,
  PHASER_DEFAULTS,
  PHASER_SLEEP,
} from '../../inserts/phaserConstants';
import type { ReportLoadMessage } from '../../synth/workletMessages';
import { LoadSampler } from '../loadSampler';
import { PhaserDsp } from './phaserDsp';
import type { PhaserParams } from './phaserDsp';

class PhaserProcessor extends AudioWorkletProcessor {
  dsp: PhaserDsp;
  running: boolean;
  load: LoadSampler;

  static get parameterDescriptors(): AudioParamDescriptor[] {
    return [
      ...Object.entries(PHASER_BOUNDS).map(([name, [minValue, maxValue]]) => ({
        name,
        minValue,
        maxValue,
        defaultValue: PHASER_DEFAULTS[name as keyof typeof PHASER_BOUNDS],
        automationRate: 'k-rate' as const,
      })),
      { name: 'enabled', minValue: 0, maxValue: 1, defaultValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const params: PhaserParams = {};
    for (const descriptor of PhaserProcessor.parameterDescriptors) {
      const name = descriptor.name;
      params[name] = new Float32Array([
        Number(options.parameterData?.[name] ?? descriptor.defaultValue),
      ]);
    }
    // `sleep: false` is a test's, to prove the renders with and without it agree.
    this.dsp = new PhaserDsp(sampleRate, params, options.processorOptions?.sleep !== false);
    this.running = true;
    this.load = new LoadSampler(sampleRate, this.port);
    this.port.onmessage = ({ data }: MessageEvent<{ type: 'stop' } | ReportLoadMessage>) => {
      if (data.type === 'stop') this.running = false;
      if (data.type === 'reportLoad') this.load.start(data.quanta);
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], params: PhaserParams): boolean {
    if (!this.running) return false;
    this.load.begin();
    const out = outputs[0];
    if (!out?.[0]) return true;
    const left = inputs[0]?.[0];
    const right = inputs[0]?.[1] ?? left;
    const frames = out[0].length;
    const dsp = this.dsp;
    dsp.configure(params, dsp.sleepEnabled && this.silent(left, right));
    if (dsp.asleep) this.rest(out, frames);
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
    const input = dsp.input,
      output = dsp.output;
    for (let i = 0; i < frames; i++) {
      // Through slots, not arguments, which V8 boxes across a call it does not inline.
      input[0] = i < leftFrames ? left![i] : 0;
      input[1] = i < rightFrames ? right![i] : 0;
      dsp.tick();
      out[0][i] = output[0];
      if (out[1]) out[1][i] = output[1];
    }
  }

  /** Every sample of the block within the sleep floor; an absent channel is silent. */
  silent(left: Float32Array | undefined, right: Float32Array | undefined): boolean {
    const floor = PHASER_SLEEP.inputFloor;
    if (left) for (let i = 0; i < left.length; i++) if (Math.abs(left[i]) > floor) return false;
    if (right && right !== left)
      for (let i = 0; i < right.length; i++) if (Math.abs(right[i]) > floor) return false;
    return true;
  }

  /**
   * One asleep block: zeros, the input's silence to within its floor, and the DSP's control-only
   * `rest`, which keeps the glides, the fade, the follower and the sweep moving (windsor#802).
   */
  rest(out: Float32Array[], frames: number): void {
    out[0].fill(0);
    if (out[1]) out[1].fill(0);
    this.dsp.rest(frames);
  }
}

registerProcessor(PHASER_NAME, PhaserProcessor);
