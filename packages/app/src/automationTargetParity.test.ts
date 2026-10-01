/**
 * The automation catalog against the knobs it locks (windsor#341, record
 * `2026-10-01-song-automation-lanes` decisions 5 and 6): a lane moves a knob
 * and is drawn in that knob's scale, so every voice row's range is the Parts
 * tab's knob at the same patch path and every strip row's is the Song tab's
 * mixer knob. A logarithmic lane sits over a log knob, and a decay time's
 * floor is the knob's own.
 */
import { describe, expect, it } from 'vitest';
import {
  RETURN_NAMES,
  STRIP_AUTOMATION_ROWS,
  VOICE_AUTOMATION_ROWS,
  type AutomationTargetRow,
} from '@windsor/engine';
import { STRIP_LEVEL_KNOB, STRIP_PAN_KNOB, sendKnob } from './mixerTables';
import { allPatchKnobs } from './patchKnobTables';

const isLogLane = (row: AutomationTargetRow): boolean => row.scale !== 'linear';

describe('the voice rows', () => {
  const knobs = new Map(allPatchKnobs().map((knob) => [knob.path, knob.entry.o]));

  it("match the Parts tab's knob at the same path", () => {
    for (const row of VOICE_AUTOMATION_ROWS) {
      const path = row.target.slice('voice.'.length);
      const knob = knobs.get(path);
      expect(knob, path).toBeDefined();
      expect(row.min, path).toBe(knob!.min);
      expect(row.max, path).toBe(knob!.max);
      expect(isLogLane(row), path).toBe(knob!.curve === 'log');
      if (knob!.curve === 'log' && knob!.min <= 0) expect(row.floor, path).toBe(knob!.logFloor);
    }
  });
});

describe('the strip rows', () => {
  const byTarget = new Map(STRIP_AUTOMATION_ROWS.map((row) => [row.target as string, row]));

  it("match the Song tab's mixer knobs", () => {
    const knobs = [
      ['strip.level', STRIP_LEVEL_KNOB],
      ['strip.pan', STRIP_PAN_KNOB],
      ...RETURN_NAMES.map((name) => [`strip.send.${name}`, sendKnob(name)] as const),
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
