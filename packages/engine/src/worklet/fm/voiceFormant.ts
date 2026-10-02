/* eslint-disable no-magic-numbers -- DSP: the decibel-to-gain law (10^(dB/20)) is the arithmetic; the tunables are fmConstants.ts and formantTables.ts */
/**
 * The Formant filter mode's control-rate half (windsor#331, record
 * `2026-10-02-formant-filter-mode`): three bandpass peaks at a vowel's first
 * three formants, which the render loops run in parallel from the same input
 * on the voice's `svfA`, `svfB` and `svfC` and sum by each section's `gain`.
 *
 * `updateVoiceFilter` (`voiceControl.ts`) works out the filter's modulation
 * as it does for every mode (envelope, wheel, both LFOs, key track) and, in
 * this mode, leaves its `2^octaves` in `FORMANT_SHIFT_SLOT` in place of
 * moving `cutoff`, which the mode does not use: a cutoff lane or step leaves
 * the peaks alone, as the Cutoff knob does (windsor#419). This sets each peak's centre to its formant, read from
 * `FORMANT_VOWELS` with the voice's vowel (the patch's `filter.vowel`, moved
 * by a song lane or a step: windsor#406, windsor#419) morphing linearly between two rows by its
 * fraction, times that shift, so the three move together; each shares one Q,
 * `resonance × FORMANT_Q_PER_RESONANCE` capped at `FORMANT_Q_MAX`; and each
 * gain is its level (the rows' decibels morphed, then to a gain) times
 * `FORMANT_MAKEUP` over the Q its section was tuned at (the section's `k`,
 * `1 / max(0.5, q)`): a state-variable bandpass peaks at that Q, so every
 * peak stands at its level whatever the resonance. A section whose centre
 * and Q are what it was last tuned to keeps its coefficients, and a peak
 * whose level in dB is unchanged keeps its gain's power of ten, so a held
 * vowel with nothing moving it does no transcendental work a block
 * (`docs/research/2026-10-02-formant-filter/`), and a moving one retunes at
 * most the three sections a block (`docs/research/2026-10-02-vowel-automation/`). `cutoffHz` and `q` are
 * written only beside a `setCoeffs`, here and in the serial path, so a
 * section's coefficients always answer to them, across a live switch of
 * the mode too.
 *
 * Invariants: called once per control block, never per sample; allocates
 * nothing, and no double crosses a call (worklet rule 2): the shift arrives
 * in `FORMANT_SHIFT_SLOT`, the resonance is the voice's live value
 * (`liveValues`, with a lane's or a step's offset), the vowel too
 * (`VT_VOWEL`, windsor#406: the bound patch's exactly without one), and
 * `Svf.setCoeffs` reads its fields.
 * `synth/fmProcessorFilterFormant.test.ts` pins the peaks, the morph, the
 * modulation, the Q and the levels through the shipped bundle;
 * `fmProcessorKernel.test.ts` that both render loops sum them to the bit.
 */

import type { Voice } from './voice';
import { FORMANT_MAKEUP, FORMANT_Q_MAX, FORMANT_Q_PER_RESONANCE } from './fmConstants';
import { FORMANT_PEAKS, FORMANT_VOWELS } from './formantTables';
import { VT_RESONANCE, VT_VOWEL } from './voiceTargetTables';

/** The last row a morph starts from: a vowel at the table's top morphs from the row below at t = 1. */
const FORMANT_LAST_FROM = FORMANT_VOWELS.length - 2;

/**
 * The modulation's `2^octaves` for the voice being updated, which
 * `updateVoiceFilter` writes here just before it calls `updateVoiceFormant`,
 * in place of an argument (rule 2): one slot serves every voice, since the
 * control updates run one voice at a time.
 */
const FORMANT_SHIFT_SLOT = new Float64Array(1);

/**
 * Tune the three peaks for this block from the voice's live vowel, its
 * resonance and the shift in `FORMANT_SHIFT_SLOT`. Allocates nothing.
 */
function updateVoiceFormant(voice: Voice): void {
  const vowel = voice.liveValues[VT_VOWEL];
  const whole = vowel | 0;
  const from = whole > FORMANT_LAST_FROM ? FORMANT_LAST_FROM : whole;
  const t = vowel - from;
  const lo = FORMANT_VOWELS[from];
  const hi = FORMANT_VOWELS[from + 1];
  const shift = FORMANT_SHIFT_SLOT[0];
  const scaled = voice.liveValues[VT_RESONANCE] * FORMANT_Q_PER_RESONANCE;
  const q = scaled > FORMANT_Q_MAX ? FORMANT_Q_MAX : scaled;
  for (let k = 0; k < FORMANT_PEAKS; k++) {
    const svf = k === 0 ? voice.svfA : k === 1 ? voice.svfB : voice.svfC;
    const hz = lo.hz[k] + (hi.hz[k] - lo.hz[k]) * t;
    const cutoff = hz * shift;
    // A section already tuned to these inputs keeps its coefficients.
    if (svf.cutoffHz !== cutoff || svf.q !== q) {
      svf.cutoffHz = cutoff;
      svf.q = q;
      svf.setCoeffs(voice.sr);
    }
    const db = lo.db[k] + (hi.db[k] - lo.db[k]) * t;
    if (svf.levelDb !== db) {
      svf.levelDb = db;
      svf.level = Math.pow(10, db / 20);
    }
    svf.gain = svf.level * FORMANT_MAKEUP * svf.k;
  }
}

export { FORMANT_SHIFT_SLOT, updateVoiceFormant };
