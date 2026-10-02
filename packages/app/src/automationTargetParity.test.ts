/**
 * The automation catalog's strip rows against the knobs they lock
 * (windsor#341, record `2026-10-01-song-automation-lanes` decisions 5 and 6):
 * a lane moves a knob and is drawn in that knob's scale, so every strip row's
 * range is the Song tab's mixer knob. A voice row needs no such check: the
 * Parts tab's knob over a voice target takes its range from the row itself
 * (windsor#436, record `2026-10-02-knob-ranges-from-the-catalog`), which
 * `patchKnobRange.test.ts` covers.
 */
import { describe, expect, it } from 'vitest';
import { RETURN_NAMES, STRIP_AUTOMATION_ROWS, formatTargetId } from '@windsor/engine';
import { STRIP_LEVEL_KNOB, STRIP_PAN_KNOB, sendKnob } from './mixerTables';

describe('the strip rows', () => {
  const byTarget = new Map(STRIP_AUTOMATION_ROWS.map((row) => [row.target as string, row]));

  it("match the Song tab's mixer knobs", () => {
    const knobs = [
      ['strip.level', STRIP_LEVEL_KNOB],
      ['strip.pan', STRIP_PAN_KNOB],
      ...RETURN_NAMES.map(
        (name) =>
          [formatTargetId({ kind: 'strip', field: `send.${name}` }), sendKnob(name)] as const,
      ),
    ] as const;
    expect(STRIP_AUTOMATION_ROWS).toHaveLength(knobs.length);
    for (const [target, knob] of knobs) {
      const row = byTarget.get(target);
      expect(row, target).toBeDefined();
      expect(row!.min, target).toBe(knob.min);
      expect(row!.max, target).toBe(knob.max);
    }
  });
});
