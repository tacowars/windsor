/* eslint-disable no-magic-numbers -- DSP: the interpolators' polynomial, the quantum of 128 and the cubic's four-sample reach are the algorithm; the tunables are reverbConstants.ts (#671) */
/**
 * The plate's delay lines (#671): allocation (`_makeDelay`), the SIZE-scaled
 * lengths and taps and their per-sample ramp (`_applySize`), the write, and the
 * three fractional reads -- linear from the read point, linear back from the
 * write head for the output taps, cubic for the two modulated tank lines.
 * Each is a function over the processor (`this: DattorroReverb`), installed on
 * its prototype by `reverbProcessor.ts`, so its body is the method it was in
 * the hand-written `reverb-processor.js`, line for line, but for how a sample
 * crosses the call (windsor#227): a read leaves its sample in `this._value`
 * and `_write1` stores `this._value`, the cubic read's offset is
 * `this._offset`, and a tap is named by its index. V8 boxes a double passed
 * to or returned from a call it does not inline, and it inlined only some of
 * the tank's forty-six reads and writes a sample, so the plate allocated
 * about 41 KB a quantum; a double field is written in place. Invariant: no
 * allocation after construction, and the reads' operations in the order the
 * golden table was written from; `mixer/reverbGolden.test.ts` pins them,
 * `mixer/reverbProcessor.test.ts` checks the reads directly and
 * `mixer/reverbAllocation.test.ts` holds the render to no allocation on V8.
 */

import { FIRST_TANK_LINE, LINE_COUNT, MIN_LENGTH, TAP_LINE, TAP_TIME } from './reverbConstants';
import type { DattorroReverb } from './reverbProcessor';

/**
 * Allocate one line. `headroom` over-allocates so SIZE can stretch it; the
 * extra four samples are the cubic interpolator's reach past its read point.
 */
function _makeDelay(this: DattorroReverb, seconds: number, headroom: number): void {
  const index = this._buffers.length;
  const nominal = seconds * sampleRate;
  const capacity = Math.ceil(nominal * headroom) + 4;
  const size = 2 ** Math.ceil(Math.log2(capacity));

  this._buffers.push(new Float32Array(size));
  this._mask[index] = size - 1;
  this._nominal[index] = nominal;
  this._length[index] = Math.max(1, nominal);
}

/**
 * Aim every scaled length and tap at `this._size`, as a per-sample ramp. The
 * size is the field, not an argument, so no double crosses the call.
 *
 * Setting the lengths outright once a block is not enough. A two-second sweep
 * from 0.3 to 3 moves the longest line's read point by about 26 samples per
 * 128-sample block, so holding it constant within the block leaves a step at
 * every boundary -- measured at ten times the signal's own slew, and plainly
 * audible. Ramping across the block leaves only the Doppler shift, which is
 * what sweeping a delay line is supposed to sound like.
 */
function _applySize(this: DattorroReverb, immediate: boolean): void {
  const size = this._size;
  for (let i = FIRST_TANK_LINE; i < LINE_COUNT; i++) {
    this._lengthTarget[i] = Math.max(MIN_LENGTH, this._nominal[i] * size);
  }
  for (let t = 0; t < TAP_TIME.length; t++) {
    // Every tap is shorter than its own line, so scaling both keeps it inside
    // the valid history. The margin keeps the interpolator's second sample
    // behind the write head even at the longest tap.
    const target = Math.min(this._lengthTarget[TAP_LINE[t]] - 2, TAP_TIME[t] * sampleRate * size);
    if (immediate) this._tap[t] = target;
    this._tapStep[t] = immediate ? 0 : (target - this._tap[t]) / 128;
  }
  // Whether this block's per-sample length and tap bookkeeping moves anything.
  // A step is not 0 just because SIZE is still: `_tap` is Float32 and its
  // target a double, so a settled tap keeps a sub-ulp step forever. What
  // matters is whether one add changes the stored value -- if it does not,
  // none of the block's identical adds will, and skipping them is exact.
  let stepping = false;
  for (let t = 0; t < TAP_TIME.length; t++) {
    if (Math.fround(this._tap[t] + this._tapStep[t]) !== this._tap[t]) stepping = true;
  }
  for (let i = FIRST_TANK_LINE; i < LINE_COUNT; i++) {
    if (immediate) this._length[i] = this._lengthTarget[i];
    this._lengthStep[i] = immediate ? 0 : (this._lengthTarget[i] - this._length[i]) / 128;
    if (Math.fround(this._length[i] + this._lengthStep[i]) !== this._length[i]) stepping = true;
  }
  this._stepping = stepping;
}

/**
 * Read `offset` samples forward of the line's read point, interpolating, into
 * `this._value`. The tank's offsets are all 0, a small integer, which V8 passes
 * without a box.
 *
 * Lengths are fractional because SIZE moves them: rounding to whole samples
 * made a sweep step the read point, which measured as a sample-to-sample jump
 * ten times the signal's own slew -- an audible zipper on the one knob most
 * likely to be swept while a chord rings.
 */
function _read(this: DattorroReverb, index: number, offset: number): void {
  const buffer = this._buffers[index];
  const mask = this._mask[index];
  const position = this._write[index] - this._length[index] + offset;
  const whole = Math.floor(position);
  const frac = position - whole;

  const a = buffer[whole & mask];
  const b = buffer[(whole + 1) & mask];
  this._value = a + (b - a) * frac;
}

/** Store `this._value` at the line's write head. */
function _write1(this: DattorroReverb, index: number): void {
  this._buffers[index][this._write[index]] = this._value;
}

/**
 * Output tap `t`'s fractional read, `this._tap[t]` samples back from the write
 * head of its line, into `this._value`.
 *
 * The output taps are delays, not offsets from the oldest sample, so they do
 * not go through `_read` -- see the TAP_TIME note above.
 */
function _readTap(this: DattorroReverb, t: number): void {
  const index = TAP_LINE[t];
  const delay = this._tap[t];
  const buffer = this._buffers[index];
  const mask = this._mask[index];
  const position = this._write[index] - delay;
  const whole = Math.floor(position);
  const frac = position - whole;

  const a = buffer[whole & mask];
  const b = buffer[(whole + 1) & mask];
  this._value = a + (b - a) * frac;
}

/**
 * Fractional read, `this._offset` samples forward of the line's read point,
 * into `this._value`. The offset is the modulation's excursion, a double, so
 * it comes in a field rather than as an argument.
 *
 * Cubic rather than linear because these two reads carry the tank's delay
 * modulation: linear interpolation is a lowpass whose cutoff moves with the
 * fraction, which the ear hears as a chirp on the modulated tail.
 * O. Niemitalo, https://www.musicdsp.org/en/latest/Other/49-cubic-interpollation.html
 */
function _readCubic(this: DattorroReverb, index: number): void {
  const buffer = this._buffers[index];
  const mask = this._mask[index];
  // Split the *whole* read position, exactly as _read does. Flooring
  // `write - length` on its own and taking the fraction from `offset` alone
  // drops the fractional part of the length, so every time SIZE carries the
  // length across an integer the read point jumps a full sample -- which is
  // the artefact the per-sample length ramp exists to remove, reintroduced on
  // the two lines that carry the modulation.
  const position = this._write[index] - this._length[index] + this._offset;
  const whole = Math.floor(position);
  const frac = position - whole;
  let at = whole - 1;

  const x0 = buffer[at++ & mask];
  const x1 = buffer[at++ & mask];
  const x2 = buffer[at++ & mask];
  const x3 = buffer[at & mask];

  const a = (3 * (x1 - x2) - x0 + x3) / 2;
  const b = 2 * x2 + x0 - (5 * x1 + x3) / 2;
  const c = (x2 - x0) / 2;
  this._value = ((a * frac + b) * frac + c) * frac + x1;
}

export { _makeDelay, _applySize, _read, _write1, _readTap, _readCubic };
