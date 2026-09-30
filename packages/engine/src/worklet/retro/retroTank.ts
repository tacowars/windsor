/**
 * Original four-line orthogonal feedback network. No emulated instructions or ROM-derived taps.
 * Samples cross calls in fields (`input` in, `left`/`right` out, `lineInput`/`feedback` into
 * `write`, the lines' own `delay`/`output`/`input`), never as arguments or results, which V8
 * boxes across a call it does not inline (worklet rule 2); every double field is first written
 * as one (rule 7). Tested through retroReverbDsp.test.ts and retroReverbAllocation.test.ts.
 */
import {
  RETRO_REVERB_BOUNDS as B,
  RETRO_REVERB_DSP as C,
} from '../../inserts/retroReverbConstants';
import { RetroDelay } from './retroDelay';

class RetroTank {
  lines: RetroDelay[];
  diffusers: RetroDelay[];
  damping: Float64Array;
  gains: Float64Array;
  values: Float64Array;
  size: number;
  diffusion: number;
  pole: number;
  left: number;
  right: number;
  /** The sample `tick` takes. */
  input: number;
  /** The signed input share and the feedback `write` mixes into a line. */
  lineInput: number;
  feedback: number;

  constructor() {
    this.lines = C.tankSeconds.map((t) => new RetroDelay(t * B.size[1] * C.rate));
    this.diffusers = C.diffuserSeconds.map((t) => new RetroDelay(t * C.rate));
    this.damping = new Float64Array(C.tankSeconds.length);
    this.gains = new Float64Array(C.tankSeconds.length);
    this.values = new Float64Array(C.tankSeconds.length);
    this.size = this.diffusion = this.pole = this.left = this.right = NaN;
    this.input = this.lineInput = this.feedback = NaN;
    this.size = 1;
    this.diffusion = this.pole = this.left = this.right = 0;
    this.input = this.lineInput = this.feedback = 0;
  }

  configure({
    size,
    decay,
    tone,
    diffusion,
  }: {
    size: number;
    decay: number;
    tone: number;
    diffusion: number;
  }): void {
    this.size = size;
    this.diffusion = diffusion * C.maxDiffusion;
    this.pole = 1 - Math.exp(-(2 * Math.PI * tone) / C.rate);
    for (let i = 0; i < this.lines.length; i++)
      this.gains[i] = Math.pow(C.decayTarget, (C.tankSeconds[i] * size) / decay);
  }

  tick(): void {
    let input = this.input;
    for (let i = 0; i < this.diffusers.length; i++) {
      const delay = this.diffusers[i];
      delay.delay = C.diffuserSeconds[i] * C.rate;
      delay.read();
      const old = delay.output;
      const value = input - this.diffusion * old;
      delay.input = value;
      delay.write();
      input = old + this.diffusion * value;
    }
    const y = this.values;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      line.delay = C.tankSeconds[i] * this.size * C.rate;
      line.read();
      const raw = line.output;
      const damped = this.damping[i] + this.pole * (raw - this.damping[i]);
      y[i] = this.damping[i] = Math.abs(damped) < C.silenceFloor ? 0 : damped;
    }
    // Normalized Hadamard transform: preserves feedback energy before loss.
    this.lineInput = input;
    this.feedback = (y[0] + y[1] + y[2] + y[3]) / 2;
    this.write(0);
    this.feedback = (y[0] - y[1] + y[2] - y[3]) / 2;
    this.write(1);
    this.lineInput = -input;
    this.feedback = (y[0] + y[1] - y[2] - y[3]) / 2;
    this.write(2);
    this.feedback = (y[0] - y[1] - y[2] + y[3]) / 2;
    this.write(this.lines.length - 1);
    this.left = (y[0] + y[1] - y[2] - y[3]) * C.outputTrim;
    this.right = (y[0] - y[1] + y[2] - y[3]) * C.outputTrim;
  }

  /** Line `i` takes `lineInput` and `feedback`, mixed and clamped. */
  write(i: number): void {
    const value = this.lineInput * C.inputTrim + this.feedback * this.gains[i];
    const line = this.lines[i];
    line.input = Math.max(-C.stateLimit, Math.min(C.stateLimit, value));
    line.write();
  }
}

export { RetroTank };
