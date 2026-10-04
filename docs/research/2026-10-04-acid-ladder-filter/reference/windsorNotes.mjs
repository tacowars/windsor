/* global structuredClone */
/**
 * Windsor's half of the reference comparison (windsor#574, decision 6): the
 * factory `acid-saw` and `acid-square` reduced to the ACB recipe (a single
 * `SAW` or `SQUARE` carrier, no drive, filter envelope amount 0, no wheel,
 * the amp envelope held at full level, velocity sensitivity 0), played at the
 * ACB's notes with a 2 s gate, and measured in the same window as the
 * recordings. The renders go through `scripts/sound-match/render.mjs` (the
 * shipped bundle) unless tunables are overridden, when they go through
 * `../audition/bundleVariant.mjs`, the same bundle with those numbers
 * changed.
 *
 * The Cut Off map: for each ACB cutoff section, the Windsor cutoff whose
 * resonance emphasis at the top of the Reso knob (reso 12) falls where the
 * ACB's at 100 % resonance does, on note 33 (the finest harmonic spacing),
 * found by moving the cutoff by the ratio of the two frequencies until they
 * agree within `MAP_TOLERANCE`.
 */
import { renderNote as shippedNote, resolvePatch } from '../../../../scripts/sound-match/render.mjs';
import { loadVariant, renderNote as variantNote } from '../audition/bundleVariant.mjs';
import { emphasis, measureNote } from './spectrum.mjs';

export const SR = 48000;
/** The Reso knob at 0, 50, 90 and 100 % of its travel: 0.5 × 24^t, the knob's log sweep. */
export const RESO_TRAVEL = [0, 0.5, 0.9, 1];
export const resoAt = (t) => 0.5 * 24 ** t;
const NOTE_SECONDS = 2;
const MAP_TOLERANCE = 0.005;
const MAP_ROUNDS = 12;

/** The factory patch reduced to the ACB recipe; `level` is the carrier's peak into the ladder. */
export function referencePatch(id, level) {
  const patch = structuredClone(resolvePatch(id));
  patch.algorithm = 0;
  patch.volume = level;
  patch.glide = 0;
  patch.ops.forEach((op, i) => {
    op.level = i === 0 ? 1 : 0;
    op.velSens = 0;
    op.env = { ...op.env, attackTime: 0.002, peakLevel: 1, sustainLevel: 1, releaseTime: 0.02 };
  });
  patch.filter = { ...patch.filter, envAmount: 0, modWheelDepth: 0, keyTrack: 0, lfoAmount: 0 };
  patch.drive = { ...patch.drive, on: false };
  return patch;
}

/** A renderer of one 2 s note: the shipped bundle's, or a variant's when `overrides` names any. */
export function noteRenderer(overrides) {
  const changed = Object.keys(overrides).length > 0;
  const variant = changed ? loadVariant(overrides) : null;
  return (patch, note) => {
    const options = { note, velocity: 1, seconds: NOTE_SECONDS, gate: NOTE_SECONDS, seed: 1 };
    return changed ? variantNote(variant, patch, options) : shippedNote(patch, options);
  };
}

const withFilter = (patch, cutoff, resonance) => ({
  ...patch,
  filter: { ...patch.filter, cutoff, resonance },
});

/** One note's readings, its window as the recordings' (onset 0). */
function measure(render, patch, note, window) {
  const samples = render(patch, note);
  const nominalHz = 440 * 2 ** ((note - 69) / 12);
  return measureNote(samples, SR, { onset: 0, nominalHz, ...window });
}

/**
 * The cutoff whose emphasis at reso 12 on `note`, searched within `band`,
 * falls at `targetHz`; starts at the target.
 */
export function fitCutoff(render, patch, { note, targetHz, window, floorDb, band }) {
  let cutoff = targetHz;
  let reading = null;
  for (let round = 0; round < MAP_ROUNDS; round++) {
    const base = measure(render, withFilter(patch, cutoff, resoAt(0)), note, window);
    const top = measure(render, withFilter(patch, cutoff, resoAt(1)), note, window);
    reading = emphasis(top.levels, base.levels, top.f0, floorDb, band);
    const ratio = targetHz / reading.hz;
    if (Math.abs(Math.log(ratio)) < MAP_TOLERANCE) break;
    cutoff *= ratio;
  }
  return { cutoff, emphasisHz: reading.hz };
}

/** Every note at every cutoff and Reso travel: `[travel][section][note]` readings. */
export function measureWindsor(render, patch, { cutoffs, notes, window }) {
  return RESO_TRAVEL.map((t) =>
    cutoffs.map((cutoff) =>
      notes.map((note) => measure(render, withFilter(patch, cutoff, resoAt(t)), note, window)),
    ),
  );
}
