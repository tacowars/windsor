/**
 * The Song tab's "+ Add lane" picker shares the part's voice slots with its
 * clip envelopes (epic windsor#699 decision 6): seven song voice lanes and
 * one envelope on another target fill the eight, so a new distinct voice
 * target is refused while a target already holding a slot stays open.
 */
import { describe, expect, it } from 'vitest';
import { AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';

import type { DocumentPart, VoiceTargetPath } from '@windsor/engine';
import {
  DEFAULT_ROLL_CONFIG,
  FM_LANES_MAX,
  TICKS_PER_BAR,
  VOICE_AUTOMATION_ROWS,
  targetKind,
} from '@windsor/engine';
import { voiceSlotsUsed } from './partVoiceSlots';
import { newLane, pickerGroups, voiceCountLabel } from './songAutomationModel';

/** The voice rows a part whose patch defines no macro is offered. */
const ROWS = VOICE_AUTOMATION_ROWS.filter((r) => r.section.kind !== 'macro');
const LANE_ROWS = ROWS.slice(0, FM_LANES_MAX - 1);
const ENVELOPE_ROW = ROWS[FM_LANES_MAX - 1]!;

/** Seven voice lanes, and a roll whose region pattern holds an envelope on the eighth row. */
const PART: DocumentPart = {
  ...AUTOMATION_PART,
  automation: LANE_ROWS.map((row) => newLane(row.target, 0, TICKS_PER_BAR)),
  sequencer: { kind: 'roll', ...DEFAULT_ROLL_CONFIG },
  regions: [
    {
      start: 0,
      duration: TICKS_PER_BAR,
      pattern: {
        kind: 'roll',
        ...DEFAULT_ROLL_CONFIG,
        envelopes: [{ target: ENVELOPE_ROW.path as VoiceTargetPath, on: true, points: [] }],
      },
    },
  ],
};

describe('the Song picker’s voice slots (windsor#707)', () => {
  it('counts the envelope: 7 lanes and 1 envelope are 8 of 8', () => {
    expect(voiceSlotsUsed(PART)).toBe(FM_LANES_MAX);
    expect(voiceCountLabel(voiceSlotsUsed(PART))).toBe(`Voice ${FM_LANES_MAX}/${FM_LANES_MAX}`);
  });

  it('refuses a new distinct voice target and keeps the envelope’s target open', () => {
    const voice = pickerGroups(PART)
      .flatMap((g) => g.options)
      .filter((o) => targetKind(o.target) === 'voice');
    // The lanes' own targets stay disabled for already having a lane, as before.
    expect(voice.filter((o) => !o.disabled).map((o) => o.target)).toEqual([ENVELOPE_ROW.target]);
  });
});
