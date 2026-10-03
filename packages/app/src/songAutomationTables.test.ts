/**
 * The automation lanes' tables (windsor#348): the picker's voice group
 * labels, a reason for every kind whose fields can be unread, and the
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
import { INACTIVE_WHY, voiceGroupLabel } from './songAutomationTables';

describe('voiceGroupLabel', () => {
  it('names each section, an operator by its letter (windsor#436)', () => {
    expect(voiceGroupLabel({ kind: 'filter' }, OP_NAMES)).toBe('Voice · Filter');
    expect(voiceGroupLabel({ kind: 'operator', op: 2 }, OP_NAMES)).toBe('Voice · Op C');
    expect(voiceGroupLabel({ kind: 'lfo' }, OP_NAMES)).toBe('Voice · LFO');
    expect(voiceGroupLabel({ kind: 'pitch' }, OP_NAMES)).toBe('Voice · Pitch');
    expect(voiceGroupLabel({ kind: 'macro', index: 3 }, OP_NAMES)).toBe('Macros');
  });

  it('gives the voice rows eight groups, each one run of the catalog, the macros last', () => {
    const labels = VOICE_AUTOMATION_ROWS.map((row) => voiceGroupLabel(row.section, OP_NAMES));
    const runs = labels.filter((label, i) => label !== labels[i - 1]);
    expect(runs).toEqual([
      'Voice · Filter',
      ...OP_NAMES.map((name) => `Voice · Op ${name}`),
      'Voice · LFO',
      'Voice · Pitch',
      'Macros',
    ]);
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

  it("blames a stage's filtering, not its filter type, for a peak lane", () => {
    const why = INACTIVE_WHY['advanced-drive']!;
    const at = (filtering: boolean, filter: 'peak' | 'lowpass') => ({
      ...DEFAULT_ADVANCED_DRIVE,
      stages: DEFAULT_ADVANCED_DRIVE.stages.map((s, i) =>
        i === 0 ? { ...s, enabled: true, filtering, filter } : s,
      ),
    });
    expect(why(at(false, 'peak'), 'stages.0.peak')).toBe('stage 1 is not filtering');
    expect(why(at(true, 'lowpass'), 'stages.0.peak')).toBe("stage 1's filter is not a peak");
  });

  it("names an EQ band's state", () => {
    const why = INACTIVE_WHY.eq!;
    const bands = DEFAULT_EQ.bands.map((b) => ({ ...b, on: false }));
    expect(why({ ...DEFAULT_EQ, bands }, 'bands.2.freq')).toBe('band 3 is off');
  });
});
