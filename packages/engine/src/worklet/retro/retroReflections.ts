/**
 * Original finite reflection field: flat/gated or rising/reverse, with no onset detector.
 * `tick` takes `input` and leaves `left`/`right`, fields rather than an argument, which V8
 * boxes across a call it does not inline (worklet rule 2); each double field is first
 * written as one (rule 7). Tested through retroReverbDsp.test.ts and retroReverbAllocation.test.ts.
 */
import {
  RETRO_REVERB_BOUNDS as B,
  RETRO_REVERB_DSP as C,
} from '../../inserts/retroReverbConstants';
import { RetroDelay } from './retroDelay';
import { makeRandom } from '../fm/prng';

class RetroReflections {
  delay: RetroDelay;
  positions: Float64Array;
  signs: Float64Array;
  offsets: Int32Array;
  fractions: Float64Array;
  gainsLeft: Float64Array;
  gainsRight: Float64Array;
  left: number;
  right: number;
  /** The sample `tick` takes. */
  input: number;

  constructor() {
    this.delay = new RetroDelay(B.duration[1] * C.rate);
    this.positions = new Float64Array(C.reflectionCount);
    this.signs = new Float64Array(C.reflectionCount * 2);
    this.offsets = new Int32Array(C.reflectionCount);
    this.fractions = new Float64Array(C.reflectionCount);
    this.gainsLeft = new Float64Array(C.reflectionCount);
    this.gainsRight = new Float64Array(C.reflectionCount);
    this.left = this.right = this.input = NaN;
    this.left = this.right = this.input = 0;
    const random = makeRandom(C.reflectionSeed);
    for (let i = 0; i < C.reflectionCount; i++) {
      this.positions[i] =
        (i + C.reflectionJitterStart + C.reflectionJitterSpan * random()) / C.reflectionCount;
      this.signs[i * 2] = random() < 1 / 2 ? 1 : -1;
      this.signs[i * 2 + 1] = random() < 1 / 2 ? 1 : -1;
    }
  }

  configure({
    duration,
    reverse,
    diffusion,
  }: {
    duration: number;
    reverse: number;
    diffusion: number;
  }): void {
    const span = duration * C.rate;
    const trim = C.reflectionTrim / Math.sqrt(C.reflectionCount);
    for (let i = 0; i < C.reflectionCount; i++) {
      const t = this.positions[i];
      const ramp = 1 - reverse + reverse * t * t * 2;
      // Sparse early texture blends to the dense field, without changing its end time.
      const density = i % C.reflectionSparseStride === 0 ? 1 : diffusion;
      const edge = Math.min(1, t / C.reflectionEdgeFraction, (1 - t) / C.reflectionEdgeFraction);
      const delay = Math.max(1, Math.min(this.delay.buffer.length - 2, t * span));
      this.offsets[i] = Math.ceil(delay);
      this.fractions[i] = Math.ceil(delay) - delay;
      const gain = ramp * edge * density * trim;
      this.gainsLeft[i] = gain * this.signs[i * 2];
      this.gainsRight[i] = gain * this.signs[i * 2 + 1];
    }
  }

  tick(): void {
    let left = 0,
      right = 0;
    const buffer = this.delay.buffer;
    const head = this.delay.head;
    const length = buffer.length;
    for (let i = 0; i < C.reflectionCount; i++) {
      let index = head - this.offsets[i];
      if (index < 0) index += length;
      const next = index + 1 === length ? 0 : index + 1;
      const value = buffer[index] + this.fractions[i] * (buffer[next] - buffer[index]);
      left += value * this.gainsLeft[i];
      right += value * this.gainsRight[i];
    }
    this.left = left;
    this.right = right;
    this.delay.input = this.input;
    this.delay.write();
  }
}

export { RetroReflections };
