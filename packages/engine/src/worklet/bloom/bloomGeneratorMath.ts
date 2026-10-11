/* eslint-disable no-magic-numbers -- the shapes' own arithmetic (odd k, k mod 4) and the series' terms */
/**
 * The generator's shape arithmetic (`bloomGenerator.ts`), off the sample path:
 *
 * - `bloomShapeMix`: Shape (`BLOOM_SHAPES`: 0 sine, 1 triangle, 2 saw,
 *   3 square, 4 pulse) as two table reads, A(θ) and B(θ + offset), in
 *   `mix` (`MIX_*` slots): from 0 to 1 sine → triangle, from 1 to 2
 *   triangle → saw, from 2 to 3 saw → square as (1 − t/2)·saw(θ) −
 *   (t/2)·saw(θ + ½), from 3 to 4 the pulse ½·saw(θ) − ½·saw(θ + w), w from
 *   ½ (the square, exactly) down to `pulseNarrowest`. Linear in the
 *   corners, so every mix is band-limited; Shape 2 is the saw alone, B's
 *   gain exactly 0.
 * - `bloomMixWeight`: partial k's weight in that mix (its magnitude for the
 *   pulse, whose partials are not all in sine phase), for the level the
 *   generator keeps every shape at.
 * - `bloomScaleCorrections`: per scale and degree above the key, the
 *   semitones to the nearest scale note (ties down).
 * - The series terms the fractional-ratio phasor runs: atan, sin, cos.
 *
 * Everything reads and writes `Float64Array` slots, so no double crosses a
 * call; nothing allocates.
 */
import { BLOOM_SCALES } from '../../inserts/bloomConstants';
import { BLOOM_GENERATOR as C, BLOOM_SCALE_STEPS } from '../../inserts/bloomGeneratorConstants';

const BLOOM_GENERATOR_DEGREES = 12;
/** Shape's corners: sine, triangle, saw, square; then the pulse's narrowing. */
const BLOOM_GENERATOR_SQUARE = 3;
/** `mix`'s slots: region (0 … 3), t, A's and B's gains, B's offset in cycles, and for the pulse cos πw. */
const MIX_REGION = 0;
const MIX_T = 1;
const MIX_GAIN_A = 2;
const MIX_GAIN_B = 3;
const MIX_OFFSET = 4;
const MIX_COS = 5;
const MIX_WEIGHT = 6;
const MIX_SLOTS = 7;
/** Which table each read takes: the triangle's first level (the sine), the triangle, the saw. */
const MIX_SINE = 0;
const MIX_TRIANGLE = 1;
const MIX_SAW = 2;

/** atan x = x Σ (−1)^j x^{2j}/(2j+1); sin θ = θ Σ (−1)^j θ^{2j}/(2j+1)!; cos θ = Σ (−1)^j θ^{2j}/(2j)!. */
const BLOOM_GENERATOR_ATAN = new Float64Array(C.atanTerms);
const BLOOM_GENERATOR_SINE = new Float64Array(C.rotationTerms);
const BLOOM_GENERATOR_COSINE = new Float64Array(C.rotationTerms);
for (let j = 0; j < C.atanTerms; j++)
  BLOOM_GENERATOR_ATAN[j] = (j % 2 === 0 ? 1 : -1) / (2 * j + 1);
{
  let factorial = 1;
  for (let j = 0; j < C.rotationTerms; j++) {
    const sign = j % 2 === 0 ? 1 : -1;
    if (j > 0) factorial *= 2 * j;
    BLOOM_GENERATOR_COSINE[j] = sign / factorial;
    factorial *= 2 * j + 1;
    BLOOM_GENERATOR_SINE[j] = sign / factorial;
  }
}

/** The pulse's sin/cos of πw, |πw| ≤ π/2, to the same accuracy. */
const BLOOM_GENERATOR_PULSE_SINE = new Float64Array(C.pulseTerms);
const BLOOM_GENERATOR_PULSE_COSINE = new Float64Array(C.pulseTerms);
{
  let factorial = 1;
  for (let j = 0; j < C.pulseTerms; j++) {
    const sign = j % 2 === 0 ? 1 : -1;
    if (j > 0) factorial *= 2 * j;
    BLOOM_GENERATOR_PULSE_COSINE[j] = sign / factorial;
    factorial *= 2 * j + 1;
    BLOOM_GENERATOR_PULSE_SINE[j] = sign / factorial;
  }
}

/** `mix` from Shape `mix[MIX_T]` (read as the shape, clamped by the caller): region, t, gains, offset. */
function bloomShapeMix(mix: Float64Array): void {
  const shape = mix[MIX_T];
  const region = shape >= BLOOM_GENERATOR_SQUARE ? BLOOM_GENERATOR_SQUARE : Math.floor(shape),
    t = shape - region;
  mix[MIX_REGION] = region;
  mix[MIX_T] = t;
  mix[MIX_OFFSET] = 0;
  mix[MIX_COS] = 1;
  if (region < 2) {
    mix[MIX_GAIN_A] = 1 - t;
    mix[MIX_GAIN_B] = t;
  } else if (region === 2) {
    mix[MIX_GAIN_A] = 1 - t / 2;
    mix[MIX_GAIN_B] = -t / 2;
    mix[MIX_OFFSET] = t > 0 ? 1 / 2 : 0;
  } else {
    const width = 1 / 2 - t * (1 / 2 - C.pulseNarrowest);
    mix[MIX_GAIN_A] = 1 / 2;
    mix[MIX_GAIN_B] = -1 / 2;
    mix[MIX_OFFSET] = width;
    // cos πw, for the pulse's partials by sin((k+1)x) = 2 cos x · sin kx − sin((k−1)x).
    const x2 = Math.PI * width * (Math.PI * width);
    let c = BLOOM_GENERATOR_PULSE_COSINE[C.pulseTerms - 1];
    for (let j = C.pulseTerms - 2; j >= 0; j--) c = c * x2 + BLOOM_GENERATOR_PULSE_COSINE[j];
    mix[MIX_COS] = c;
  }
}

/** sin πw into `mix[MIX_WEIGHT]` (the pulse's first partial's |sin πkw|, k = 1). */
function bloomPulseSine(mix: Float64Array): void {
  const x = Math.PI * mix[MIX_OFFSET],
    x2 = x * x;
  let s = BLOOM_GENERATOR_PULSE_SINE[C.pulseTerms - 1];
  for (let j = C.pulseTerms - 2; j >= 0; j--) s = s * x2 + BLOOM_GENERATOR_PULSE_SINE[j];
  mix[MIX_WEIGHT] = s * x;
}

/**
 * Partial `k`'s weight in `mix` into `mix[MIX_WEIGHT]`, all but the pulse's:
 * for the pulse the caller runs sin πkw itself (`bloomPulseSine`, `MIX_COS`).
 */
function bloomMixWeight(mix: Float64Array, k: number): void {
  const t = mix[MIX_T],
    odd = k % 2 === 1;
  const saw = (odd ? 1 : -1) / k,
    triangle = odd ? (k % 4 === 3 ? -1 : 1) / (k * k) : 0,
    sine = k === 1 ? 1 : 0;
  const region = mix[MIX_REGION];
  if (region === 0) mix[MIX_WEIGHT] = (1 - t) * sine + t * triangle;
  else if (region === 1) mix[MIX_WEIGHT] = (1 - t) * triangle + t * saw;
  else mix[MIX_WEIGHT] = odd ? saw : (1 - t) * saw;
}

/**
 * Per scale (`BLOOM_SCALES` order) and degree above the key, the semitones to
 * the nearest note of the scale: 0 in it, −d or +d out of it, a tie down.
 * Index scale·12 + degree. Constructor only.
 */
function bloomScaleCorrections(): Int32Array {
  const table = new Int32Array(BLOOM_SCALES.length * BLOOM_GENERATOR_DEGREES);
  BLOOM_SCALES.forEach((name, s) => {
    const steps = BLOOM_SCALE_STEPS[name] ?? BLOOM_SCALE_STEPS['chromatic']!;
    const inScale = (d: number): boolean =>
      steps.includes((d + BLOOM_GENERATOR_DEGREES) % BLOOM_GENERATOR_DEGREES);
    for (let d = 0; d < BLOOM_GENERATOR_DEGREES; d++) {
      if (inScale(d)) continue;
      let down = 1,
        up = 1;
      while (!inScale(d - down)) down++;
      while (!inScale(d + up)) up++;
      table[s * BLOOM_GENERATOR_DEGREES + d] = down <= up ? -down : up;
    }
  });
  return table;
}

export {
  BLOOM_GENERATOR_ATAN,
  BLOOM_GENERATOR_COSINE,
  BLOOM_GENERATOR_DEGREES,
  BLOOM_GENERATOR_SINE,
  MIX_COS,
  MIX_GAIN_A,
  MIX_GAIN_B,
  MIX_OFFSET,
  MIX_REGION,
  MIX_SAW,
  MIX_SINE,
  MIX_SLOTS,
  MIX_T,
  MIX_TRIANGLE,
  MIX_WEIGHT,
  bloomMixWeight,
  bloomPulseSine,
  bloomScaleCorrections,
  bloomShapeMix,
};
