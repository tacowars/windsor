/**
 * The Dub delay's route (record `2026-10-17-dub-delay-regeneration`): two
 * preallocated lines whose every repeat passes the whole loop again:
 *
 *   read (Wow-modulated, interpolated) → loop filter → saturation and its
 *   governor → low cut → damping shelf → × Feedback, with Cross between the
 *   lines → + the new input → write.
 *
 * Feedback stops at unity. Sustain moves the loop's gain to exactly unity and
 * the input's to zero (over `sustainSeconds`), so the lines hold what they
 * carry while it keeps passing the loop; the dry signal stays. A resonant
 * filter can lift the loop past unity at its cutoff; the governor
 * (`delaySaturation.ts`) holds the result at its ceiling, a steady
 * self-oscillation. Cross splits each line's feedback between itself and the
 * other line, so 1 alternates every repeat between the sides; its matrix adds
 * no gain. Time moves glide and bend pitch; no buffer resets.
 *
 * A sample and a line's read pass through fields (`inputLeft` and
 * `inputRight` in, `left` and `right` out, `readMs` and `value` between a
 * read, the loop and a write), and the controls are Float64Array slots
 * (`delaySlots.ts`, `delayControls.ts`), so the render allocates nothing: no
 * double crosses a call as an argument or a return, and every double field is
 * first written as NaN (worklet rules 2 and 7, windsor#232).
 * inserts/delayAllocation.test.ts pins that on V8.
 *
 * The on/off switch moves `enabled` linearly over `INSERT_SWITCH_FADE_S`
 * (windsor#630) and lands on its target exactly, so fully off is the input to
 * the bit. The first quantum that starts fully off clears the lines, filters,
 * governors and tone, in place: the tail is cut, never resumed.
 *
 * Sleep (windsor#793, `DELAY_SLEEP`): `write` notes a write above the floor,
 * or the first non-zero write into empty lines, and `drowse`, called from
 * `configure` every block, counts the frames since the last one. Once that is
 * the line's whole length, or the lines hold exact zeros, a silent block puts
 * the delay to sleep, unless the loop can hold or grow what is in it: `held`,
 * set when Sustain is on or moving, or when Feedback times the filter's
 * largest gain at the current or target Resonance reaches unity (the
 * governor's output RMS never exceeds its input's, the read, the cross
 * matrix, the low cut and the shelf are at most unity, so that bound is the
 * loop's). Held lines that are not empty never sleep and wake if they slept.
 * Asleep: the processor writes zeros with no `tick`, the lines and every
 * filter state wait as they are, and `rest` steps the controls, the motion
 * and the filter's tuning a sample at a time as `tick` does, with no audio.
 * `delaySleep.test.ts` holds the tail, the wake and the bits.
 */
import { DELAY_DSP as C, DELAY_SLEEP as Z } from '../../inserts/delayConstants';
import { exp2InPlace } from '../fm/portablePowers';
import { DelayControlState } from './delayControls';
import type { DelayParams } from './delayControls';
import { DelayLoopFilter } from './delayLoopFilter';
import { DelayMotion } from './delayMotion';
import { DelaySaturation } from './delaySaturation';
import { DELAY_SLOT as S } from './delaySlots';

/** Each line's tone state: the low cut's two poles and the damping shelf's one. */
const TONE_STATES = 3;
/** log2(10) / 20, and the bound's knee: below a gain of √½ the low-pass and high-pass shapes peak at unity. */
const BOUND_DB_EXPONENT = (Math.LOG2E * Math.LN10) / C.dbDivisor;
const PEAKLESS_GAIN = Math.SQRT1_2;

class DelayDsp {
  readonly rate: number;
  readonly buffer: Float32Array[];
  readonly tone: Float64Array;
  readonly scratch: Float64Array;
  readonly c: DelayControlState;
  readonly filter: DelayLoopFilter;
  readonly saturation: DelaySaturation;
  readonly motion: DelayMotion;
  position: number;
  /** Samples until the loop filter's next tuning. */
  countdown: number;
  /** The lines and filters hold nothing since the switch last reached off. */
  cleared: boolean;
  /** The host sample `tick` reads. */
  inputLeft: number;
  inputRight: number;
  /** A read's time, and the sample between a read, the loop and a write. */
  readMs: number;
  value: number;
  /** `tick`'s results. */
  left: number;
  right: number;
  /** Whether it may sleep: `sleep: false` is a test's, to render the delay without it. */
  readonly sleepEnabled: boolean;
  asleep: boolean;
  /** A line write crossed the output floor since the last block began. */
  loudWrite: boolean;
  /** Frames since the last write above the floor; a line's length or more once it is empty. */
  quietFrames: number;
  /** The lines hold exact zeros: built or cleared, and nothing non-zero written since. */
  empty: boolean;
  /** The loop can hold or grow what it carries: no sleep. */
  held: boolean;

  constructor(rate: number, _params: DelayParams, sleep = true) {
    // Doubles first written as doubles (worklet rule 7).
    this.rate = this.inputLeft = this.inputRight = this.readMs = this.value = NaN;
    this.left = this.right = this.quietFrames = NaN;
    this.rate = rate;
    const length = Math.ceil(rate * C.maxSeconds) + 2;
    this.buffer = [new Float32Array(length), new Float32Array(length)];
    this.tone = new Float64Array(2 * TONE_STATES);
    this.scratch = new Float64Array(1);
    this.c = new DelayControlState(rate);
    this.filter = new DelayLoopFilter(rate);
    this.saturation = new DelaySaturation(rate);
    this.motion = new DelayMotion(rate);
    this.position = this.countdown = 0;
    this.inputLeft = this.inputRight = this.readMs = this.value = this.left = this.right = 0;
    this.cleared = true;
    this.sleepEnabled = sleep;
    this.asleep = this.loudWrite = this.held = false;
    this.empty = true;
    this.quietFrames = length;
  }

  /** The block's controls; `quiet` is every input sample of it within the sleep floor. */
  configure(params: DelayParams, frames: number, quiet: boolean): void {
    this.c.configure(params);
    if (this.c.controls[S.enabled] !== 0) this.cleared = false;
    else if (!this.cleared) this.clear();
    this.hold();
    this.drowse(frames, quiet);
  }

  /** Whether the loop's gain can reach unity: Sustain, or Feedback times the filter's largest gain. */
  hold(): void {
    const s = this.c.controls;
    const t = this.c.targets;
    this.scratch[0] = Math.max(s[S.resonance], t[S.resonance]) * BOUND_DB_EXPONENT;
    exp2InPlace(this.scratch, 0);
    const gain = this.scratch[0];
    // A resonant low-pass or high-pass peaks at Q / √(1 − 1/4Q²), above the bell's and band's gain.
    const twice = 2 * gain;
    const bound = gain > PEAKLESS_GAIN ? gain / Math.sqrt(1 - 1 / (twice * twice)) : 1;
    const sustained = s[S.sustain] > 0 || t[S.sustain] > 0;
    this.held = sustained || Math.max(s[S.feedback], t[S.feedback]) * bound >= 1;
  }

  /** The sleep's count, every block: a loud or held block wakes it; a silent one sleeps once the lines are. */
  drowse(frames: number, quiet: boolean): void {
    // Held, a write under the floor can grow past it; lines of exact zeros stay zeros.
    const holding = this.held && !this.empty;
    if (!quiet || holding) this.asleep = false;
    if (this.asleep) return;
    if (this.loudWrite || holding) {
      this.quietFrames = 0;
      this.empty = false;
    } else this.quietFrames += frames;
    this.loudWrite = false;
    if (quiet && this.quietFrames >= this.buffer[0].length) this.asleep = true;
  }

  /** One asleep block of `frames`: `tick`'s control, motion and tuning path a sample at a time, no audio. */
  rest(frames: number): void {
    for (let n = 0; n < frames; n++) this.step();
  }

  /** One sample of the controls, the motion and the filter's tuning, awake or asleep. */
  step(): void {
    const s = this.c.controls;
    this.c.glide();
    this.motion.rate = s[S.modRate];
    this.motion.wave = this.c.targets[S.wave];
    this.motion.advance();
    if (--this.countdown <= 0) {
      this.countdown = C.filterInterval;
      const f = this.filter;
      f.resonanceDb = s[S.resonance];
      f.widthOctaves = s[S.width];
      f.octaves = s[S.cutoff] + s[S.sweep] * this.motion.left;
      f.tune(0, this.c.filterTo);
      f.octaves = s[S.cutoff] + s[S.sweep] * this.motion.right;
      f.tune(1, this.c.filterTo);
    }
  }

  /** Fully off: the tail goes, so the lines and every filter start from silence. */
  clear(): void {
    this.buffer[0].fill(0);
    this.buffer[1].fill(0);
    this.filter.clear();
    this.saturation.clear();
    this.tone.fill(0);
    this.cleared = true;
    this.loudWrite = false;
    this.empty = true;
    this.quietFrames = this.buffer[0].length;
  }

  /** One host sample: `inputLeft` and `inputRight` into `left` and `right`. */
  tick(): void {
    const left = this.inputLeft;
    const right = this.inputRight;
    const s = this.c.controls;
    this.step();
    const wow = s[S.wow] * C.wowSpan;
    this.readMs = s[S.leftMs] * (1 + wow * this.motion.left);
    this.read(0);
    this.loop(0);
    const a = this.value;
    this.readMs = s[S.rightMs] * (1 + wow * this.motion.right);
    this.read(1);
    this.loop(1);
    const b = this.value;
    const mid = (left + right) / 2;
    const side = (left - right) / 2;
    const inputA = left + s[S.mid] * (mid - left) + s[S.ping] * (mid - left);
    const inputB = right + s[S.mid] * (side - right) - s[S.ping] * right;
    const hold = s[S.sustain];
    const feedback = s[S.feedback] + hold * (1 - s[S.feedback]);
    const cross = s[S.cross];
    const feed = s[S.enabled] * (1 - hold);
    this.value = inputA * feed + feedback * (a + cross * (b - a));
    this.write(0);
    this.value = inputB * feed + feedback * (b + cross * (a - b));
    this.write(1);
    const wetL = a + s[S.mid] * b;
    const wetR = b + s[S.mid] * (a - 2 * b);
    const mix = s[S.mix] * s[S.enabled];
    const gain = 1 + s[S.enabled] * (s[S.outputDb] - 1);
    this.left = (left + mix * (wetL - left)) * gain;
    this.right = (right + mix * (wetR - right)) * gain;
    if (++this.position === this.buffer[0].length) this.position = 0;
  }

  /** Line `channel`, `readMs` behind the write, linearly interpolated, into `value`. */
  read(channel: number): void {
    const buffer = this.buffer[channel];
    const samples = Math.max(
      1,
      Math.min(buffer.length - 2, (this.readMs * this.rate) / C.milliseconds),
    );
    let position = this.position - samples;
    if (position < 0) position += buffer.length;
    const index = Math.floor(position);
    const next = index + 1 === buffer.length ? 0 : index + 1;
    this.value = buffer[index] + (position - index) * (buffer[next] - buffer[index]);
  }

  /** `value` through line `line`'s loop: the filter, the saturation, the low cut and the shelf. */
  loop(line: number): void {
    const c = this.c;
    const s = c.controls;
    const f = this.filter;
    f.value = this.value;
    f.fade = c.filterFade;
    f.run(line, c.filterFrom, c.filterTo);
    const sat = this.saturation;
    sat.value = f.value;
    sat.drive = s[S.drive];
    sat.fade = c.characterFade;
    sat.run(line, c.characterFrom, c.characterTo);
    let value = sat.value;
    const tone = this.tone;
    const at = line * TONE_STATES;
    // Two one-pole high passes, then a shelf: a one-pole low pass, the rest cut to Damping.
    tone[at] += s[S.lowCut] * (value - tone[at]);
    value -= tone[at];
    tone[at + 1] += s[S.lowCut] * (value - tone[at + 1]);
    value -= tone[at + 1];
    tone[at + 2] += s[S.dampingHz] * (value - tone[at + 2]);
    this.value = tone[at + 2] + s[S.damping] * (value - tone[at + 2]);
  }

  /** `value` into line `channel` at the write position. */
  write(channel: number): void {
    const value = this.value;
    this.buffer[channel][this.position] = value;
    if (value > Z.outputFloor || value < -Z.outputFloor || (this.empty && value !== 0)) {
      this.loudWrite = true;
    }
  }
}

export { DelayDsp };
export type { DelayParams };
