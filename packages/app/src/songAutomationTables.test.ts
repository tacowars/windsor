/**
 * The automation lanes' tables (windsor#348): every voice row in exactly one
 * picker group, a reason for every kind whose fields can be unread, and the
 * reasons the stage and band kinds give.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADVANCED_DRIVE,
  DEFAULT_EQ,
  INSERT_AUTOMATION_FIELDS,
  OP_NAMES,
  VOICE_AUTOMATION_ROWS,
} from '@windsor/engine';
import { INACTIVE_WHY, VOICE_GROUPS } from './songAutomationTables';

describe('VOICE_GROUPS', () => {
  it('claims every voice row exactly once', () => {
    const groups = VOICE_GROUPS(OP_NAMES);
    for (const row of VOICE_AUTOMATION_ROWS) {
      const path = row.target.slice('voice.'.length);
      expect(groups.filter((g) => g.claims(path)).length, path).toBe(1);
    }
  });
});

describe('INACTIVE_WHY', () => {
  it('answers every kind whose rows can be unread', () => {
    for (const [kind, rows] of Object.entries(INSERT_AUTOMATION_FIELDS)) {
      if (rows.some((row) => row.available)) expect(INACTIVE_WHY, kind).toHaveProperty(kind);
    }
  });

  it("names an Advanced Drive stage's state", () => {
    const why = INACTIVE_WHY['advanced-drive']!;
    const stages = DEFAULT_ADVANCED_DRIVE.stages.map((s) => ({ ...s, enabled: false }));
    expect(why({ ...DEFAULT_ADVANCED_DRIVE, stages }, 'stages.0.amount')).toBe('stage 1 is off');
    expect(why(DEFAULT_ADVANCED_DRIVE, 'rate')).toBe('the LFO is synced');
  });

  it("names an EQ band's state", () => {
    const why = INACTIVE_WHY.eq!;
    const bands = DEFAULT_EQ.bands.map((b) => ({ ...b, on: false }));
    expect(why({ ...DEFAULT_EQ, bands }, 'bands.2.freq')).toBe('band 3 is off');
  });
});
