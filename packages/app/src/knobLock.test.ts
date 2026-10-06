/**
 * The insert power button's lock (windsor#631; record
 * `2026-10-06-insert-switch-lanes` decision 9): while a lane on the switch is
 * on, the button is locked in the insert lanes' colour and shows the lane's
 * level at the playhead; switched off or deleted, it is free and shows the
 * insert's own `enabled`.
 */
import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_BAR,
  type AutomationLane,
  type DocumentPart,
  type InsertSpec,
} from '@windsor/engine';
import { AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';
import { insertKnobAutomation } from './knobAutomation';
import { switchShowsOn } from './knobLock';
import { LANE_KIND_COLOR } from './songAutomationTables';

const BAR = TICKS_PER_BAR;
const SPEC: InsertSpec = { ...AUTOMATION_PART.strip.inserts[0]!, enabled: true };
const LANE: AutomationLane = {
  target: `insert.${SPEC.id!}.enabled`,
  on: true,
  points: [
    { tick: 0, value: 1, bend: 0 },
    { tick: BAR, value: 1, bend: 0 },
    { tick: BAR, value: 0, bend: 0 },
  ],
};
const partWith = (lanes: readonly AutomationLane[]): DocumentPart => ({
  ...AUTOMATION_PART,
  strip: { ...AUTOMATION_PART.strip, inserts: [SPEC] },
  automation: lanes,
});

/** What the button shows at `tick` on `part`: on or off, and its lock's colour. */
function shown(part: DocumentPart, tick: number): { on: boolean; color: string | null } {
  const lock = insertKnobAutomation(part, SPEC, 'enabled', tick);
  return { on: switchShowsOn(SPEC.enabled, lock), color: lock?.color ?? null };
}

describe("an insert's power button", () => {
  it("locks in the insert lanes' colour and follows the lane", () => {
    const part = partWith([LANE]);
    expect(shown(part, 0)).toEqual({ on: true, color: LANE_KIND_COLOR.insert });
    expect(shown(part, 2 * BAR)).toEqual({ on: false, color: LANE_KIND_COLOR.insert });
  });

  it('is free, showing the insert, once the lane is off or deleted', () => {
    expect(shown(partWith([{ ...LANE, on: false }]), 2 * BAR)).toEqual({ on: true, color: null });
    expect(shown(partWith([]), 2 * BAR)).toEqual({ on: true, color: null });
  });
});
