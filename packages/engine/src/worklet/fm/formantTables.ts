/**
 * The Formant filter's vowels (windsor#331): for each of a, e, i, o and u, in
 * that order, its first three formants' centre frequencies in Hz and their
 * levels in dB relative to the first. A patch's `filter.vowel` reads a row by
 * index, 0 a to 4 u, and a fraction morphs linearly between two neighbours
 * (`voiceFormant.ts`); `VOWEL_RANGE` in `patchDefaults.ts` is one unit per
 * row, and `patchDefaults.test.ts` pins the two together.
 *
 * Source: the bass voice's rows of the formant table in the Csound Manual's
 * appendix "Formant Values" (the published measured values the DAFX
 * literature reprints), first three formants of five, amplitudes as given.
 * The table's bandwidths are not used: the three peaks share one Q, set by
 * the patch's `resonance` (`FORMANT_Q_PER_RESONANCE` in `fmConstants.ts`).
 * tacowars may retune these by ear (record `2026-10-02-formant-filter-mode`).
 *
 * Data only, import-free: the worklet's control update reads it, and the
 * main thread may through `index.ts` (the editor's Vowel display), so it
 * never touches the worklet scope or the wave cache. Listed in the engine
 * project's `files`, so an indexed read here takes a `!`.
 */

/** One vowel: three formant centres (Hz) and their levels (dB, the first at 0). */
interface FormantVowel {
  readonly name: string;
  readonly hz: readonly [number, number, number];
  readonly db: readonly [number, number, number];
}

/** The formants per vowel; the voice runs one bandpass peak per formant. */
const FORMANT_PEAKS = 3;

/** a, e, i, o, u: the bass voice (Csound Manual, "Formant Values"). */
const FORMANT_VOWELS: readonly FormantVowel[] = [
  { name: 'a', hz: [600, 1040, 2250], db: [0, -7, -9] },
  { name: 'e', hz: [400, 1620, 2400], db: [0, -12, -9] },
  { name: 'i', hz: [250, 1750, 2600], db: [0, -30, -16] },
  { name: 'o', hz: [400, 750, 2400], db: [0, -11, -21] },
  { name: 'u', hz: [350, 600, 2400], db: [0, -20, -32] },
];

export type { FormantVowel };
export { FORMANT_PEAKS, FORMANT_VOWELS };
