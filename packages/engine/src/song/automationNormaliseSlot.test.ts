/**
 * A lane on a host's slot (record `2026-10-11-wet-path-slot`, windsor#687):
 * `insert.<hostId>.slot.<field>`, read against the live child kind's row. A
 * lane on a field the child lacks, or on an empty slot, is dropped with the
 * same correction as any field an insert does not automate.
 */
import { describe, expect, it } from 'vitest';

import { AUTOMATION_DOCUMENT, AUTOMATION_PART } from '../__fixtures__/automationSong';
import { FULL_SLOT } from '../__fixtures__/fullArrangement';
import type { AutomationTargetId } from '../automation/automationLane';
import { formatTargetId } from '../automation/automationTargets';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import type { InsertSpec } from '../inserts/insertRegistry';
import { PHASER_BOUNDS } from '../inserts/phaserConstants';
import { DEFAULT_PHASER } from '../inserts/phaserSpec';
import { makeArrangement } from './arrangementDocument';

const ECHO_ID = 'echo1';
const RATE: AutomationTargetId = formatTargetId({
  kind: 'insert',
  insertId: ECHO_ID,
  field: 'slot.rate',
});
const LANE = {
  target: RATE,
  on: true,
  points: [
    { tick: 0, value: 0.5, bend: 0 },
    { tick: 96, value: 4, bend: 0 },
  ],
};

/** The hat holding one Echo with `slot`, and only `LANE`, normalised. */
function hatWith(slot: InsertSpec | null) {
  const echo = { ...DEFAULT_ECHO, id: ECHO_ID, slot };
  const hat = { ...AUTOMATION_PART, strip: { ...AUTOMATION_PART.strip, inserts: [echo] } };
  const result = makeArrangement({
    ...AUTOMATION_DOCUMENT,
    parts: AUTOMATION_DOCUMENT.parts.map((part) =>
      part.slot === FULL_SLOT.hat ? { ...hat, automation: [LANE] } : part,
    ),
  });
  const part = result.document.parts.find((p) => p.slot === FULL_SLOT.hat)!;
  return { lanes: part.automation, corrections: result.corrections };
}

describe('a lane on a slot field', () => {
  it("loads on a Phaser child, within the Phaser's range", () => {
    const { lanes, corrections } = hatWith({ ...DEFAULT_PHASER, id: 'ph1' });
    expect(corrections).toEqual([]);
    expect(lanes).toEqual([LANE]);
    expect(LANE.points.every((p) => p.value >= PHASER_BOUNDS.rate[0])).toBe(true);
  });

  it('is dropped, reported, with the slot empty', () => {
    const { lanes, corrections } = hatWith(null);
    expect(lanes).toBeUndefined();
    expect(corrections).toEqual([
      `parts[1].automation[0].target: echo has no automatable "slot.rate" — lane dropped`,
    ]);
  });
});
