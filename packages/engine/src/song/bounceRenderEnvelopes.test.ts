/**
 * Bounce to Roll's step-mod envelopes (windsor#740, record
 * `2026-10-11-bounce-to-roll` decision 4, "Step-mod lanes"): each moved row
 * held from onset to onset, a change two points 1/64 tick apart, and the
 * result a valid roll envelope.
 */
import { describe, expect, it } from 'vitest';

import { bounceSong, gridNote, gridSpec, render } from '../__fixtures__/bounceRig';
import { stepModEnvelopes } from './bounceRenderEnvelopes';
import { assertRollEnvelopes } from '../sequencing/rollEnvelope';
import { VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';

const STEP = 1 / 64;
const CUTOFF = VOICE_TARGET_PATHS.indexOf('filter.cutoff');
const RESO = VOICE_TARGET_PATHS.indexOf('filter.resonance');

/** A step's offsets with `row` at `value`. */
const mod = (entries: ReadonlyArray<readonly [number, number]>): number[] => {
  const out = new Array<number>(VOICE_TARGET_PATHS.length).fill(0);
  for (const [row, value] of entries) out[row] = value;
  return out;
};

describe('stepModEnvelopes', () => {
  it('holds each onset’s value to the next, a change being the old value 1/64 tick before and the new on it', () => {
    const envelopes = stepModEnvelopes([
      { tick: 0, stepMod: mod([[CUTOFF, 0.5]]) },
      { tick: 6, stepMod: mod([[CUTOFF, 0.5]]) },
      { tick: 12, stepMod: undefined },
      { tick: 18, stepMod: mod([[CUTOFF, -0.25]]) },
    ]);
    expect(envelopes).toEqual([
      {
        target: 'filter.cutoff',
        on: true,
        points: [
          { tick: 0, value: 0.5, bend: 0 },
          { tick: 12 - STEP, value: 0.5, bend: 0 },
          { tick: 12, value: 0, bend: 0 },
          { tick: 18 - STEP, value: 0, bend: 0 },
          { tick: 18, value: -0.25, bend: 0 },
        ],
      },
    ]);
    expect(() => assertRollEnvelopes(envelopes)).not.toThrow();
  });

  it('writes one envelope per moved row in table order, none for a row at 0 on every onset', () => {
    const envelopes = stepModEnvelopes([
      { tick: 3, stepMod: mod([[RESO, 0.25]]) },
      { tick: 9, stepMod: mod([[CUTOFF, 1]]) },
    ]);
    expect(envelopes.map((envelope) => envelope.target)).toEqual([
      VOICE_TARGET_PATHS[Math.min(CUTOFF, RESO)],
      VOICE_TARGET_PATHS[Math.max(CUTOFF, RESO)],
    ]);
    // The first onset is one point, at its own tick and value, 0 included.
    const cutoff = envelopes.find((envelope) => envelope.target === 'filter.cutoff');
    expect(cutoff?.points[0]).toEqual({ tick: 3, value: 0, bend: 0 });
    expect(stepModEnvelopes([{ tick: 0, stepMod: undefined }])).toEqual([]);
  });

  it('reads one onset per tick, the first note’s, so a chord is one point', () => {
    const envelopes = stepModEnvelopes([
      { tick: 0, stepMod: mod([[CUTOFF, 0.5]]) },
      { tick: 0, stepMod: mod([[CUTOFF, 0.5]]) },
      { tick: 0, stepMod: mod([[CUTOFF, 0.5]]) },
    ]);
    expect(envelopes[0]?.points).toEqual([{ tick: 0, value: 0.5, bend: 0 }]);
  });
});

describe('a Grid’s step-mod lane, rendered', () => {
  it('becomes an envelope on the same target that changes only at the onsets', () => {
    const lanes = [{ param: 'filter.cutoff' as const, values: [0.5, 0.5, 0, -0.25] }];
    const steps = [gridNote(0), gridNote(2), gridNote(4), gridNote(2)];
    const song = bounceSong(gridSpec(steps, { lanes }), { regions: [{ start: 0, duration: 48 }] });
    const { envelopes } = render(song);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.target).toBe('filter.cutoff');
    expect(envelopes[0]?.points).toEqual([
      { tick: 0, value: 0.5, bend: 0 },
      { tick: 12 - STEP, value: 0.5, bend: 0 },
      { tick: 12, value: 0, bend: 0 },
      { tick: 18 - STEP, value: 0, bend: 0 },
      { tick: 18, value: -0.25, bend: 0 },
      { tick: 24 - STEP, value: -0.25, bend: 0 },
      { tick: 24, value: 0.5, bend: 0 },
      { tick: 36 - STEP, value: 0.5, bend: 0 },
      { tick: 36, value: 0, bend: 0 },
      { tick: 42 - STEP, value: 0, bend: 0 },
      { tick: 42, value: -0.25, bend: 0 },
    ]);
  });
});
