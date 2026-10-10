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
 * the output is today's to the bit (`retroReverbNeutralPin.test.ts`). Drift is heard only through
 * the tank's share of the wet output, `1 - finite` (a finite mode replaces the tank), so its depth
 * is scaled by that share: 1 exactly in reverb mode, so reverb mode is unchanged, and once the
 * share is under the floor Drift is off, as at depth 0, and costs nothing.
 *
 * Size (RV-4): `configure` takes the block's Size as a target and `tick` moves the lines' `size`
 * to it in equal steps over the internal ticks the block runs (`sizeTicks` counts them down), and
 * the last of them sets it to the target, so it lands exactly at any host rate and block size, so a Size move
 * sweeps the reads rather than jumping them once a block (a zipper). A Size that holds has a step
 * of 0 and reads exactly as before. The lines are sized for the largest Size plus Drift's reach.
 *
 * Density (RV-3): besides the line ends, each output sums taps inside the lines
 * (`densityFractions`), Dattorro's plate output taps (1997, Part 1) applied to the four lines. A
 * line's whole loss is applied on write, so a tap a fraction f along it reads a sample that will
 * lose nothing more before the end: weighted by the line's gain to the power f - 1, it sits on the
 * same decay envelope as the end, and the RT60 is unchanged (the taps only read; nothing feeds
 * back). The weight is held at `densityMaxBoost` (6 dB over the end): past it, where a line loses
 * most of its level in one pass, the envelope would put a tap tens of dB over anything the input
 * played, and the loudness match would then mute the ends at any Density above 0. A held tap still
 * decays at the tank's rate, a little under the envelope; where the first pass is nearly the whole
 * response (Size 10, Decay 0.5 s and under), the taps fill it evenly instead of front-loading it,
 * which lengthens its -5 to -25 dB fit, though nothing sounds later than at Density 0 (rv3.md).
 * Each channel is scaled by 1 / sqrt(1 + Σ (d × weight)² / E), E its ends' sum's energy in taps
 * at the block's Tone, Size and Decay (`RetroDensityLevel`, a measured table), so ends and taps
 * together keep the level of the ends alone. Like Drift, Density is scaled by the tank's share;
 * at 0 no tap is read and the outputs are today's expressions, to the bit.
 */
import {
  RETRO_REVERB_BOUNDS as B,
  RETRO_REVERB_DSP as C,
} from '../../inserts/retroReverbConstants';
import { RetroDelay } from './retroDelay';
import { RetroDensityLevel } from './retroDensityLevel';

class RetroTank {
  lines: RetroDelay[];
  diffusers: RetroDelay[];
  damping: Float64Array;
  gains: Float64Array;
  values: Float64Array;
  /**
   * The lines' Size now, the block's target, the step a tick towards it (0 when there) and the
   * ticks left in the move.
   */
  size: number;
  sizeTarget: number;
  sizeStep: number;
  sizeTicks: number;
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
  /** Density times the tank's share; 0 skips the taps. */
  density: number;
  /** Per tap, line-major: its line, its fraction, its signs (`densityLeft`/`densityRight`). */
  tapLines: Uint8Array;
  tapFractions: Float64Array;
  tapSignsLeft: Float64Array;
  tapSignsRight: Float64Array;
  /**
   * Per tap: its delay in samples as whole samples (rounded up) less a fraction, set each block
   * and each tick of a Size move, read in place rather than through `RetroDelay.read` (the same interpolation, at half the cost
   * measured in `docs/research/2026-10-10-retro-reverb-extensions/rv3.md`), and its gain in each
   * output.
   */
  tapWhole: Int32Array;
  tapFraction: Float64Array;
  tapGainsLeft: Float64Array;
  tapGainsRight: Float64Array;
  /** The ends' energy in taps at the block's Tone, Size and Decay, for the loudness match. */
  level: RetroDensityLevel;
  /** The line ends' gain in each output while the taps play, and the taps' sums a sample. */
  endLeft: number;
  endRight: number;
  tapLeft: number;
  tapRight: number;

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
    const taps = C.densityFractions.flat().length;
    this.tapLines = Uint8Array.from(C.densityFractions.flatMap((row, i) => row.map(() => i)));
    this.tapFractions = Float64Array.from(C.densityFractions.flat());
    this.tapSignsLeft = Float64Array.from(C.densityLeft.flat());
    this.tapSignsRight = Float64Array.from(C.densityRight.flat());
    this.tapWhole = new Int32Array(taps);
    this.tapFraction = new Float64Array(taps);
    this.tapGainsLeft = new Float64Array(taps);
    this.tapGainsRight = new Float64Array(taps);
    this.level = new RetroDensityLevel();
    this.density = this.endLeft = this.endRight = this.tapLeft = this.tapRight = NaN;
    this.density = this.endLeft = this.endRight = this.tapLeft = this.tapRight = 0;
    this.size = this.diffusion = this.pole = this.left = this.right = NaN;
    this.sizeTarget = this.sizeStep = this.sizeTicks = NaN;
    this.input = this.lineInput = this.feedback = NaN;
    this.driftPhase = this.driftStep = this.excursion = this.detune = NaN;
    this.size = this.sizeTarget = 1;
    this.sizeStep = this.sizeTicks = 0;
    this.diffusion = this.pole = this.left = this.right = 0;
    this.input = this.lineInput = this.feedback = 0;
    this.driftPhase = this.driftStep = this.excursion = this.detune = 0;
  }

  configure({
    size,
    ticks,
    decay,
    tone,
    diffusion,
    driftRate,
    driftDepth,
    density,
    finite,
  }: {
    size: number;
    /**
     * Internal ticks the block runs, which the move to `size` spans; 0 (the first block, or a
     * dormant one) lands on it at once.
     */
    ticks: number;
    decay: number;
    tone: number;
    diffusion: number;
    driftRate: number;
    driftDepth: number;
    density: number;
    /** The finite field's share of the wet output (`RetroReverbDsp.finite`). */
    finite: number;
  }): void {
    this.sizeTarget = size;
    this.sizeStep = 0;
    this.sizeTicks = ticks;
    if (ticks > 0) this.sizeStep = (size - this.size) / ticks;
    else this.size = size;
    this.driftStep = (2 * driftRate) / C.rate;
    const share = 1 - finite;
    const depth = share > C.silenceFloor ? driftDepth * share : 0;
    this.excursion = depth * C.driftExcursion * C.rate;
    const detune = depth * C.detuneExcursion * C.rate;
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
    this.density = share > C.silenceFloor ? density * share : 0;
    if (this.density === 0) return;
    this.placeTaps();
    this.level.point[0] = tone;
    this.level.point[1] = size;
    this.level.point[2] = decay;
    this.level.match();
    this.weighTaps();
  }

  /**
   * The taps' delays at the lines' Size now: once a block while Size holds, and on every tick of
   * a Size move (RV-4's ramp), so the taps glide with the line ends rather than step each block.
   * Taps and ends scale with the same Size, so every tap stays at least 0.18 of its line short of
   * the end at any Size up to 10 (1.4 ms at Size 0.25), beyond Drift's 0.5 ms either way, and
   * inside the buffer, which holds the longest end at Size 10.
   */
  placeTaps(): void {
    for (let k = 0; k < this.tapWhole.length; k++) {
      const delay = this.tapFractions[k] * C.tankSeconds[this.tapLines[k]] * this.size * C.rate;
      this.tapWhole[k] = Math.ceil(delay);
      this.tapFraction[k] = this.tapWhole[k] - delay;
    }
  }

  /**
   * The taps' gains at this Density and the lines' gains, once a block: each on its line end's
   * envelope, held at `densityMaxBoost` over the end, and the ends turned down to match.
   */
  weighTaps(): void {
    let left = 0,
      right = 0;
    for (let k = 0; k < this.tapWhole.length; k++) {
      const line = this.tapLines[k];
      const fraction = this.tapFractions[k];
      const weight =
        this.density * Math.min(Math.pow(this.gains[line], fraction - 1), C.densityMaxBoost);
      this.tapGainsLeft[k] = this.tapSignsLeft[k] * weight;
      this.tapGainsRight[k] = this.tapSignsRight[k] * weight;
      left += this.tapGainsLeft[k] * this.tapGainsLeft[k];
      right += this.tapGainsRight[k] * this.tapGainsRight[k];
    }
    // The taps' energy against the ends' sum's (`level` holds 1 / E for each output).
    this.endLeft = C.outputTrim / Math.sqrt(1 + left * this.level.left);
    this.endRight = C.outputTrim / Math.sqrt(1 + right * this.level.right);
    for (let k = 0; k < this.tapWhole.length; k++) {
      this.tapGainsLeft[k] *= this.endLeft;
      this.tapGainsRight[k] *= this.endRight;
    }
  }

  /**
   * Every tap, read before this sample's writes, into `tapLeft`/`tapRight`: the sample `whole`
   * back, moved `fraction` of the way to the one after it, as `RetroDelay.read` interpolates.
   */
  readTaps(): void {
    let left = 0,
      right = 0;
    for (let k = 0; k < this.tapWhole.length; k++) {
      const line = this.lines[this.tapLines[k]];
      const buffer = line.buffer;
      let index = line.head - this.tapWhole[k];
      if (index < 0) index += buffer.length;
      const next = index + 1 === buffer.length ? 0 : index + 1;
      const value = buffer[index] + this.tapFraction[k] * (buffer[next] - buffer[index]);
      left += this.tapGainsLeft[k] * value;
      right += this.tapGainsRight[k] * value;
    }
    this.tapLeft = left;
    this.tapRight = right;
  }

  /**
   * One tick of a Size move: the lines' `size` a step on, and the taps placed at it. The block's
   * last tick sets the target itself, so rounding in the steps never leaves it short.
   */
  stepSize(): void {
    this.sizeTicks--;
    this.size = this.sizeTicks > 0 ? this.size + this.sizeStep : this.sizeTarget;
    if (this.sizeTicks === 0) this.sizeStep = 0;
    if (this.density !== 0) this.placeTaps();
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
    if (this.sizeStep !== 0) this.stepSize();
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
    if (this.density !== 0) this.readTaps();
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
    if (this.density === 0) {
      this.left = (y[0] + y[1] - y[2] - y[3]) * C.outputTrim;
      this.right = (y[0] - y[1] + y[2] - y[3]) * C.outputTrim;
    } else {
      this.left = (y[0] + y[1] - y[2] - y[3]) * this.endLeft + this.tapLeft;
      this.right = (y[0] - y[1] + y[2] - y[3]) * this.endRight + this.tapRight;
    }
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
