/**
 * Song version 8 → 9 (RV-4): Retro Reverb's Size row moved from linear to
 * log. The upgrade is an identity step, so a version-8 song with a Retro
 * Size lane opens at this build's version with nothing but `version`
 * changed, and its lane plays along the log curve.
 */
import { describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { FULL_DOCUMENT, FULL_STRIPS, withDocumentPart } from '../__fixtures__/fullArrangement';
import { valueAt } from '../automation/automationEvaluate';
import { insertTargetRow } from '../automation/automationTargets';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import type { InsertSpec } from '../inserts/insertRegistry';
import { DEFAULT_RETRO_REVERB } from '../inserts/retroReverbSpec';
import { makeArrangement } from './arrangementDocument';
import { PATCH_MIGRATIONS } from '../patch/patchMigrations';
import { SONG_MIGRATIONS, upgradeSong } from './songMigrations';

const RETRO = { ...DEFAULT_RETRO_REVERB, id: 'retro1' } as InsertSpec;
const END = 384;
const SIZE = lane('insert.retro1.size', [point(0, 0.25), point(END, 3)]);

/** A version-8 song whose hat strip carries a Retro Reverb, its Size drawn 0.25 → 3 unbent. */
const versionEight = (): Record<string, unknown> => ({
  ...structuredClone(
    withDocumentPart(FULL_DOCUMENT, 'hat', {
      strip: { ...FULL_STRIPS.hat, inserts: [RETRO] },
      automation: [SIZE],
    }),
  ),
  version: 8,
});

/**
 * The shipped steps and stand-ins 10 → 11 to 14 → 15 and 16 → 17: windsor#748,
 * windsor#761, windsor#764, windsor#746, windsor#771 and windsor#842 ship none, so
 * a version-10 to 14 or 16 song is refused, and
 * this reads a step's own work through to a version this build loads.
 */
const PAST_TEN = {
  songs: {
    ...SONG_MIGRATIONS,
    10: (doc: Record<string, unknown>) => doc,
    11: (doc: Record<string, unknown>) => doc,
    12: (doc: Record<string, unknown>) => doc,
    13: (doc: Record<string, unknown>) => doc,
    14: (doc: Record<string, unknown>) => doc,
    16: (doc: Record<string, unknown>) => doc,
  },
  patches: PATCH_MIGRATIONS,
};

describe('a version-8 song with a Retro Reverb Size lane (RV-4)', () => {
  it("upgrades to this build's version with nothing but its version changed", () => {
    const raw = versionEight();
    const { document, refused } = upgradeSong(raw, PAST_TEN);
    expect(refused).toBeUndefined();
    expect(document).toEqual({ ...raw, version: ARRANGEMENT_VERSION });
  });

  it('plays its lane along the log curve: the midpoint is the geometric mean', () => {
    const result = makeArrangement(upgradeSong(versionEight(), PAST_TEN).document);
    expect(result.refused).toBeUndefined();
    const hat = result.document.parts.find((part) => part.automation?.length)!;
    const saved = hat.automation![0]!;
    expect(saved).toEqual(SIZE);
    const row = insertTargetRow(DEFAULT_RETRO_REVERB, 'size')!;
    expect(valueAt(row, saved.points, END / 2)).toBeCloseTo(Math.sqrt(0.25 * 3), 6);
  });
});
