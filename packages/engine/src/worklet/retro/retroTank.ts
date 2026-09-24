/** Original four-line orthogonal feedback network. No emulated instructions or ROM-derived taps. */
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

  constructor() {
    this.lines = C.tankSeconds.map((t) => new RetroDelay(t * B.size[1] * C.rate));
    this.diffusers = C.diffuserSeconds.map((t) => new RetroDelay(t * C.rate));
    this.damping = new Float64Array(C.tankSeconds.length);
    this.gains = new Float64Array(C.tankSeconds.length);
    this.values = new Float64Array(C.tankSeconds.length);
    this.size = 1;
    this.diffusion = this.pole = this.left = this.right = 0;
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

  tick(input: number): void {
    for (let i = 0; i < this.diffusers.length; i++) {
      const delay = this.diffusers[i];
      const old = delay.read(C.diffuserSeconds[i] * C.rate);
      const value = input - this.diffusion * old;
      delay.write(value);
      input = old + this.diffusion * value;
    }
    const y = this.values;
    for (let i = 0; i < this.lines.length; i++) {
      const raw = this.lines[i].read(C.tankSeconds[i] * this.size * C.rate);
      const damped = this.damping[i] + this.pole * (raw - this.damping[i]);
      y[i] = this.damping[i] = Math.abs(damped) < C.silenceFloor ? 0 : damped;
    }
    // Normalized Hadamard transform: preserves feedback energy before loss.
    this.write(0, input, (y[0] + y[1] + y[2] + y[3]) / 2);
    this.write(1, input, (y[0] - y[1] + y[2] - y[3]) / 2);
    this.write(2, -input, (y[0] + y[1] - y[2] - y[3]) / 2);
    this.write(this.lines.length - 1, -input, (y[0] - y[1] - y[2] + y[3]) / 2);
    this.left = (y[0] + y[1] - y[2] - y[3]) * C.outputTrim;
    this.right = (y[0] - y[1] + y[2] - y[3]) * C.outputTrim;
  }

  write(i: number, input: number, feedback: number): void {
    const value = input * C.inputTrim + feedback * this.gains[i];
    this.lines[i].write(Math.max(-C.stateLimit, Math.min(C.stateLimit, value)));
  }
}

export { RetroTank };
