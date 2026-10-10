/**
 * Original four-line orthogonal feedback network. No emulated instructions or ROM-derived taps.
 * Samples cross calls in fields (`input` in, `left`/`right` out, `lineInput`/`feedback` into
 * `write`, the lines' own `delay`/`output`/`input`), never as arguments or results, which V8
 * boxes across a call it does not inline (worklet rule 2); every double field is first written
 * as one (rule 7). Tested through retroReverbDsp.test.ts and retroReverbAllocation.test.ts.
 *
 * Drift (RV-2): one triangle LFO moves the four line reads, each by its signed share of the
 * excursion (delay-line modulation as in Dattorro 1997, Part 2), and sweeps a short delay on each
 * wet output, L and R in opposite directions, for a stereo detune. At depth 0 both excursions
 * are exactly 0: the LFO holds, the line reads are today's and the output delays are skipped, so
 * the output is today's to the bit (`retroReverbNeutralPin.test.ts`).
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
  /** The wet outputs' detune delays. */
  detuneLeft: RetroDelay;
  detuneRight: RetroDelay;
  /**
   * The LFO's phase (-1..1, one cycle), its step a sample, and the two excursions in samples at
   * the depth.
   */
  driftPhase: number;
  driftStep: number;
  excursion: number;
  detune: number;

  constructor() {
    // Room for the longest line at the largest Size plus its read's furthest drift.
    this.lines = C.tankSeconds.map(
      (t, i) =>
        new RetroDelay(
          (t * B.size[1] + C.driftExcursion * Math.abs(C.driftLineDepths[i])) * C.rate,
        ),
    );
    this.detuneLeft = new RetroDelay(1 + 2 * C.detuneExcursion * C.rate);
    this.detuneRight = new RetroDelay(1 + 2 * C.detuneExcursion * C.rate);
    this.diffusers = C.diffuserSeconds.map((t) => new RetroDelay(t * C.rate));
    this.damping = new Float64Array(C.tankSeconds.length);
    this.gains = new Float64Array(C.tankSeconds.length);
    this.values = new Float64Array(C.tankSeconds.length);
    this.size = this.diffusion = this.pole = this.left = this.right = NaN;
    this.input = this.lineInput = this.feedback = NaN;
    this.driftPhase = this.driftStep = this.excursion = this.detune = NaN;
    this.size = 1;
    this.diffusion = this.pole = this.left = this.right = 0;
    this.input = this.lineInput = this.feedback = 0;
    this.driftPhase = this.driftStep = this.excursion = this.detune = 0;
  }

  configure({
    size,
    decay,
    tone,
    diffusion,
    driftRate,
    driftDepth,
  }: {
    size: number;
    decay: number;
    tone: number;
    diffusion: number;
    driftRate: number;
    driftDepth: number;
  }): void {
    this.size = size;
    this.driftStep = (2 * driftRate) / C.rate;
    this.excursion = driftDepth * C.driftExcursion * C.rate;
    const detune = driftDepth * C.detuneExcursion * C.rate;
    // The output delays are written only while Drift is on. Coming back on, they hold the last
    // output, so the first reads, a few samples back, never reach an old tail. Filled by index:
    // `fill(this.left)` would pass a double to a call V8 may not inline, which boxes it.
    if (this.detune === 0 && detune !== 0) {
      const left = this.detuneLeft.buffer;
      const right = this.detuneRight.buffer;
      for (let i = 0; i < left.length; i++) left[i] = this.left;
      for (let i = 0; i < right.length; i++) right[i] = this.right;
    }
    this.detune = detune;
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
    // The LFO runs only while Drift is on; at depth 0 it holds and the reads are today's.
    let triangle = 0;
    if (this.detune !== 0) {
      let phase = this.driftPhase + this.driftStep;
      if (phase >= 1) phase -= 2;
      this.driftPhase = phase;
      triangle = 2 * Math.abs(phase) - 1;
    }
    const y = this.values;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      line.delay = C.tankSeconds[i] * this.size * C.rate;
      if (triangle !== 0) line.delay += this.excursion * C.driftLineDepths[i] * triangle;
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
    if (this.detune === 0) return;
    this.detuneLeft.input = this.left;
    this.detuneLeft.write();
    this.detuneRight.input = this.right;
    this.detuneRight.write();
    // A delay of 1 reads the sample just written, so a small depth starts from no delay.
    this.detuneLeft.delay = 1 + this.detune * (1 + triangle);
    this.detuneLeft.read();
    this.left = this.detuneLeft.output;
    this.detuneRight.delay = 1 + this.detune * (1 - triangle);
    this.detuneRight.read();
    this.right = this.detuneRight.output;
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
