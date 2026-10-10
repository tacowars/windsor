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
import { upgradeSong } from './songMigrations';

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

describe('a version-8 song with a Retro Reverb Size lane (RV-4)', () => {
  it("upgrades to this build's version with nothing but its version changed", () => {
    const raw = versionEight();
    const { document, refused } = upgradeSong(raw);
    expect(refused).toBeUndefined();
    expect(document).toEqual({ ...raw, version: ARRANGEMENT_VERSION });
  });

  it('plays its lane along the log curve: the midpoint is the geometric mean', () => {
    const result = makeArrangement(versionEight());
    expect(result.refused).toBeUndefined();
    const hat = result.document.parts.find((part) => part.automation?.length)!;
    const saved = hat.automation![0]!;
    expect(saved).toEqual(SIZE);
    const row = insertTargetRow('retro-reverb', 'size')!;
    expect(valueAt(row, saved.points, END / 2)).toBeCloseTo(Math.sqrt(0.25 * 3), 6);
  });
});
