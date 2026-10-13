/**
 * A part's voice slots (epic windsor#699 decision 6): the distinct voice
 * targets across its song voice lanes, the envelopes of every roll
 * pattern it holds and its voice CC mappings (windsor#782), the one count
 * both automation pickers read.
 */
import { describe, expect, it } from 'vitest';

import type { CcMapping, RollEnvelope, RollSpec, VoiceTargetPath } from '@windsor/engine';
import { DEFAULT_ROLL_CONFIG } from '@windsor/engine';
import { type VoiceSlotPart, laneVoicePaths, voiceSlotTargets } from './partVoiceSlots';

const env = (target: VoiceTargetPath): RollEnvelope => ({ target, on: true, points: [] });
const cc = (target: CcMapping['target']): CcMapping => ({
  source: { device: null, channel: null, cc: 74 },
  target,
  min: 0,
  max: 1,
  inverted: false,
});
const roll = (...envelopes: RollEnvelope[]): RollSpec => ({
  kind: 'roll',
  ...DEFAULT_ROLL_CONFIG,
  envelopes,
});

describe('a part’s voice slots', () => {
  it('reads the song voice lanes as paths, leaving strip lanes out', () => {
    const automation = [
      { target: 'voice.filter.cutoff', on: true, points: [] },
      { target: 'strip.level', on: true, points: [] },
    ] as const;
    expect([...laneVoicePaths({ automation: [...automation] })]).toEqual(['filter.cutoff']);
  });

  it('takes the union of the lanes, the part’s roll and every region’s pattern', () => {
    const part: VoiceSlotPart = {
      automation: [{ target: 'voice.filter.cutoff', on: true, points: [] }],
      sequencer: roll(env('filter.cutoff')),
      regions: [
        { start: 0, duration: 96, pattern: roll(env('ops.0.level'), env('filter.cutoff')) },
        { start: 96, duration: 96, pattern: roll(env('ops.1.level')) },
        { start: 192, duration: 96 },
      ],
    };
    expect([...voiceSlotTargets(part)].sort()).toEqual([
      'filter.cutoff',
      'ops.0.level',
      'ops.1.level',
    ]);
  });

  it('counts a target a lane and a mapping share once, and a strip or insert mapping not at all', () => {
    const part: VoiceSlotPart = {
      automation: [{ target: 'voice.filter.cutoff', on: true, points: [] }],
      ccMappings: [
        cc('voice.filter.cutoff'),
        cc('voice.macros.1.value'),
        cc('strip.level'),
        cc('insert.eq1.bands.0.freq'),
      ],
      sequencer: roll(),
      regions: [],
    };
    expect([...voiceSlotTargets(part)].sort()).toEqual(['filter.cutoff', 'macros.1.value']);
  });
});
