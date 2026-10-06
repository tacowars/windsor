/**
 * Song version 7 → 8 (windsor#626): the Filter insert's Reso row moved from
 * linear to log. The upgrade is an identity step, so a version-7 song with
 * a Filter Reso lane opens at version 8 with nothing but `version` changed,
 * and its lane plays along the log curve.
 */
import { describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { FULL_DOCUMENT, FULL_STRIPS, withDocumentPart } from '../__fixtures__/fullArrangement';
import { valueAt } from '../automation/automationEvaluate';
import { insertTargetRow } from '../automation/automationTargets';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { DEFAULT_FILTER } from '../inserts/filterSpec';
import type { InsertSpec } from '../inserts/insertRegistry';
import { makeArrangement } from './arrangementDocument';
import { upgradeSong } from './songMigrations';

const FILTER = { ...DEFAULT_FILTER, id: 'filt1' } as InsertSpec;
const END = 384;
const RESO = lane('insert.filt1.resonance', [point(0, 0.5), point(END, 12)]);

/** A version-7 song whose hat strip carries a Filter, its Reso drawn 0.5 → 12 unbent. */
const versionSeven = (): Record<string, unknown> => ({
  ...structuredClone(
    withDocumentPart(FULL_DOCUMENT, 'hat', {
      strip: { ...FULL_STRIPS.hat, inserts: [FILTER] },
      automation: [RESO],
    }),
  ),
  version: 7,
});

describe('a version-7 song with a Filter Reso lane (windsor#626)', () => {
  it('upgrades to 8 with nothing but its version changed', () => {
    const raw = versionSeven();
    const { document, refused } = upgradeSong(raw);
    expect(refused).toBeUndefined();
    expect(ARRANGEMENT_VERSION).toBe(8);
    expect(document).toEqual({ ...raw, version: ARRANGEMENT_VERSION });
  });

  it('plays its lane along the log curve: the midpoint is the geometric mean', () => {
    const result = makeArrangement(versionSeven());
    expect(result.refused).toBeUndefined();
    const hat = result.document.parts.find((part) => part.automation?.length)!;
    const saved = hat.automation![0]!;
    expect(saved).toEqual(RESO);
    const row = insertTargetRow('filter', 'resonance')!;
    expect(valueAt(row, saved.points, END / 2)).toBeCloseTo(Math.sqrt(0.5 * 12), 6);
  });
});
