/* global structuredClone */
/**
 * Decision 5's cases (windsor#652): synced Saws that candidate A leaves on
 * today's path. Each case is drawn two ways: `carrier`, `alias.mjs`'s one
 * held carrier at a ratio; `sweep`, `lead-sync-sweep` changed to match.
 * Research only.
 *
 * - `pm05`, `pm1`: phase-modulated by a sine at ratio 1, Level 0.5 or 1.
 *   The carrier takes Series (B into A, C and D silent); the sweep takes Series + Tap
 *   (D>C>B>A, B also sounding), so its body sine is the modulator.
 * - `fb`: feedback 0.5.
 * - `w025`: squeezed to width 0.25.
 * - `tone03`: the patch's Tone at 0.3.
 */
const ENV = { attackTime: 0, decayTime: 0.01, sustainLevel: 1, releaseTime: 0.1 };
const SILENT = { level: 0 };
const SERIES = 0;
const ADDITIVE = 7;
const SERIES_TAP = 8;

/**
 * One synced carrier on `wave` at `ratio`, held, as `alias.mjs` builds it,
 * but on Additive: on Series its silent B is still a modulator in the
 * algorithm, which candidate A's bind-time test counts as modulation.
 */
export function syncedCarrier(wave, ratio, width = 1) {
  return {
    algorithm: ADDITIVE,
    filter: { mode: 0 },
    ops: [
      { wave, ratio, level: 1, velSens: 0, width, sync: 'note', env: ENV },
      SILENT,
      SILENT,
      SILENT,
    ],
  };
}

const modulated = (level) => ({
  carrier(p) {
    p.algorithm = SERIES;
    p.ops[1] = { wave: 0, ratio: 1, level, velSens: 0, env: ENV };
  },
  sweep(p) {
    p.algorithm = SERIES_TAP;
    p.ops[1].level = level;
  },
});

/** Each case's change, applied to a copy. */
const CHANGES = {
  pm05: modulated(0.5),
  pm1: modulated(1),
  fb: {
    carrier: (p) => (p.ops[0].feedback = 0.5),
    sweep: (p) => (p.ops[0].feedback = 0.5),
  },
  w025: {
    carrier: (p) => (p.ops[0].width = 0.25),
    sweep: (p) => (p.ops[0].width = 0.25),
  },
  tone03: {
    carrier: (p) => (p.tone = 0.3),
    sweep: (p) => (p.tone = 0.3),
  },
};

const applied = (change, patch) => {
  const out = structuredClone(patch);
  change(out);
  return out;
};

/** Each case: `carrier(wave, ratio)` and `sweep(leadSyncSweep)`. */
export const FALLBACKS = Object.fromEntries(
  Object.entries(CHANGES).map(([name, c]) => [
    name,
    {
      carrier: (wave, ratio) => applied(c.carrier, syncedCarrier(wave, ratio)),
      sweep: (patch) => applied(c.sweep, patch),
    },
  ]),
);
