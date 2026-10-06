/** Two preallocated delay lines with filtered, saturating feedback. Shipped-bundle tests
 * pin routing/timing and bounded regeneration. Moving time bends pitch; no buffer resets.
 * The controls are Float64Array slots (`delaySlots.ts`), and a sample passes
 * through fields (`inputLeft` and `inputRight` in, `left` and `right` out, and
 * `value` between a line's `read` or `write` and `tick`), so the render
 * allocates nothing: no double crosses a call as an argument or a return,
 * which V8 boxes across a call it does not inline, and every double field is
 * first written as a double (worklet rules 2 and 7, windsor#232).
 * inserts/delayAllocation.test.ts pins that on V8.
 *
 * The on/off switch moves `enabled` linearly over `INSERT_SWITCH_FADE_S`
 * (windsor#630), not along the other controls' smoothing, and lands on its
 * target exactly, so fully off is the input to the bit. The first quantum
 * that starts fully off clears the lines and filters, in place: the tail is
 * cut, never resumed, and switching back on starts from silence.
 */
import { INSERT_SWITCH_FADE_S } from '../../inserts/insertConstants';
import { DELAY_DSP as C, DELAY_DEFAULTS, DELAY_MODE_IDS } from '../../inserts/delayConstants';
import { DELAY_KEYS as KEYS, DELAY_SLOT as S } from './delaySlots';
import type { DelayControls } from './delaySlots';

type DelayParams = Record<string, Float32Array>;

class DelayDsp {
  readonly rate: number;
  readonly buffer: Float32Array[];
  readonly filter: Float64Array;
  readonly smooth: number;
  readonly timeSmooth: number;
  /** How far `enabled` moves a sample. */
  readonly switchStep: number;
  readonly controls: DelayControls;
  readonly targets: DelayControls;
  position: number;
  first: boolean;
  /** The lines and filters hold nothing since the switch last reached off. */
  cleared: boolean;
  /** The host sample `tick` reads. */
  inputLeft: number;
  inputRight: number;
  /** `read`'s result, and the sample `write` stores. */
  value: number;
  /** `tick`'s results. */
  left: number;
  right: number;

  constructor(rate: number, _params: DelayParams) {
    // Doubles first written as doubles (worklet rule 7).
    this.rate = this.smooth = this.timeSmooth = this.switchStep = NaN;
    this.inputLeft = this.inputRight = this.value = this.left = this.right = NaN;
    this.rate = rate;
    const length = Math.ceil(rate * C.maxSeconds) + 2;
    this.buffer = [new Float32Array(length), new Float32Array(length)];
    this.filter = new Float64Array(C.filterStates);
    this.smooth = 1 - Math.exp(-1 / (rate * C.smoothSeconds));
    this.timeSmooth = 1 - Math.exp(-1 / (rate * C.timeSmoothSeconds));
    this.switchStep = 1 / (INSERT_SWITCH_FADE_S * rate);
    this.controls = new Float64Array(KEYS.length);
    // The defaults, the switch as 1 and the mode's crossfades at 0, read in place:
    // a spread of the defaults would build a record whose `enabled` changes type.
    for (let k = 0; k < KEYS.length; k++) {
      const key = KEYS[k];
      this.controls[k] = key === 'ping' || key === 'mid' ? 0 : Number(DELAY_DEFAULTS[key]);
    }
    this.targets = Float64Array.from(this.controls);
    this.position = 0;
    this.left = this.right = 0;
    this.first = true;
    this.cleared = true;
  }

  configure(params: DelayParams, _frames: number): void {
    const t = this.targets;
    for (let k = 0; k < KEYS.length; k++) {
      if (k !== S.ping && k !== S.mid) t[k] = params[KEYS[k]][0];
    }
    t[S.ping] = params.mode[0] === DELAY_MODE_IDS['ping-pong'] ? 1 : 0;
    t[S.mid] = params.mode[0] === DELAY_MODE_IDS['mid-side'] ? 1 : 0;
    // Smooth coefficients, not Hz: no exponentials in the sample loop.
    this.pole(S.highpass);
    this.pole(S.lowpass);
    t[S.drive] = C.dbBase ** (t[S.drive] / C.dbDivisor);
    t[S.outputDb] = C.dbBase ** (t[S.outputDb] / C.dbDivisor);
    if (this.first) {
      for (let k = 0; k < KEYS.length; k++) this.controls[k] = t[k];
      this.first = false;
    }
    if (this.controls[S.enabled] !== 0) this.cleared = false;
    else if (!this.cleared) this.clear();
  }

  /** Fully off: the tail goes, so the lines and their filters start from silence. */
  clear(): void {
    this.buffer[0].fill(0);
    this.buffer[1].fill(0);
    this.filter.fill(0);
    this.cleared = true;
  }

  /** Turns the target in `slot`, a cutoff in Hz, into its one-pole coefficient, in place. */
  pole(slot: number): void {
    const t = this.targets;
    t[slot] =
      1 - Math.exp(-((2 * Math.PI * Math.min(t[slot], this.rate * C.cutoffRateRatio)) / this.rate));
  }

  /** One host sample: `inputLeft` and `inputRight` into `left` and `right`. */
  tick(): void {
    const left = this.inputLeft;
    const right = this.inputRight;
    const s = this.controls;
    const t = this.targets;
    const k = this.smooth;
    s[S.leftMs] += this.timeSmooth * (t[S.leftMs] - s[S.leftMs]);
    s[S.rightMs] += this.timeSmooth * (t[S.rightMs] - s[S.rightMs]);
    s[S.feedback] += k * (t[S.feedback] - s[S.feedback]);
    s[S.highpass] += k * (t[S.highpass] - s[S.highpass]);
    s[S.lowpass] += k * (t[S.lowpass] - s[S.lowpass]);
    s[S.drive] += k * (t[S.drive] - s[S.drive]);
    s[S.mix] += k * (t[S.mix] - s[S.mix]);
    s[S.outputDb] += k * (t[S.outputDb] - s[S.outputDb]);
    const enabled = s[S.enabled];
    s[S.enabled] =
      t[S.enabled] > enabled
        ? Math.min(t[S.enabled], enabled + this.switchStep)
        : Math.max(t[S.enabled], enabled - this.switchStep);
    s[S.ping] += k * (t[S.ping] - s[S.ping]);
    s[S.mid] += k * (t[S.mid] - s[S.mid]);
    this.read(0, S.leftMs);
    const a = this.value;
    this.read(1, S.rightMs);
    const b = this.value;
    const mid = (left + right) / 2;
    const side = (left - right) / 2;
    const inputA = left + s[S.mid] * (mid - left) + s[S.ping] * (mid - left);
    const inputB = right + s[S.mid] * (side - right) - s[S.ping] * right;
    const feedA = a + s[S.ping] * (b - a);
    const feedB = b + s[S.ping] * (a - b);
    this.value = inputA * s[S.enabled] + s[S.feedback] * feedA;
    this.write(0);
    this.value = inputB * s[S.enabled] + s[S.feedback] * feedB;
    this.write(1);
    const wetL = a + s[S.mid] * b;
    const wetR = b + s[S.mid] * (a - 2 * b);
    const mix = s[S.mix] * s[S.enabled];
    const gain = 1 + s[S.enabled] * (s[S.outputDb] - 1);
    this.left = (left + mix * (wetL - left)) * gain;
    this.right = (right + mix * (wetR - right)) * gain;
    if (++this.position === this.buffer[0].length) this.position = 0;
  }

  /** Line `channel`, delayed by the milliseconds in control `slot` and filtered, into `value`. */
  read(channel: number, slot: number): void {
    const buffer = this.buffer[channel];
    const s = this.controls;
    const samples = Math.max(
      1,
      Math.min(buffer.length - 2, (s[slot] * this.rate) / C.milliseconds),
    );
    let position = this.position - samples;
    if (position < 0) position += buffer.length;
    const index = Math.floor(position);
    const next = index + 1 === buffer.length ? 0 : index + 1;
    let value = buffer[index] + (position - index) * (buffer[next] - buffer[index]);
    const offset = channel * C.polesPerChannel;
    // Two high-pass and two low-pass poles, inside the loop so every repeat darkens.
    for (let i = 0; i < 2; i++) {
      this.filter[offset + i] += s[S.highpass] * (value - this.filter[offset + i]);
      value -= this.filter[offset + i];
    }
    for (let i = 2; i < C.polesPerChannel; i++) {
      this.filter[offset + i] += s[S.lowpass] * (value - this.filter[offset + i]);
      value = this.filter[offset + i];
    }
    this.value = value;
  }

  /** `value`, saturated, into line `channel` at the write position. */
  write(channel: number): void {
    const limit = C.feedbackCeiling / this.controls[S.drive];
    this.buffer[channel][this.position] = limit * Math.tanh(this.value / limit);
  }
}

export { DelayDsp };
export type { DelayParams };
