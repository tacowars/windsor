import {
  DEFAULT_REVERB,
  REVERB_PRESETS,
  REVERB_PRESET_DEFAULT,
  REVERB_PRESET_GROUPS,
  makeArrangement,
  matchingReverbPreset,
  plateSpace,
} from '@windsor/engine';
import { KICK, song } from '@windsor/engine/__fixtures__/documentCases';
import { describe, expect, it } from 'vitest';
import { TEMPO_DIVISIONS } from './mixerTables';
import { PRESET_GROUPS, VOICING_OPTIONS, tempoMatches, tempoSeconds } from './returnControls';

describe('PRESET_GROUPS (windsor#774)', () => {
  it('lists the bank under its four groups in order, each preset by its number, and nothing else', () => {
    expect(PRESET_GROUPS.map((g) => g.group)).toEqual(REVERB_PRESET_GROUPS);
    const listed = PRESET_GROUPS.flatMap((g) => g.options);
    expect(listed).toEqual(
      REVERB_PRESETS.map((p) => ({ value: String(p.number), label: p.label })),
    );
  });

  it('reads a new Reverb insert as its default preset, and custom after a Size change', () => {
    expect(matchingReverbPreset(plateSpace(DEFAULT_REVERB))).toBe(REVERB_PRESET_DEFAULT);
    const edited = { ...DEFAULT_REVERB, size: DEFAULT_REVERB.size * 1.1 };
    expect(matchingReverbPreset(plateSpace(edited))).toBeUndefined();
  });
});

describe('VOICING_OPTIONS (windsor#746)', () => {
  it('offers Plate then Room, each a voicing a song keeps, and starts on the plate', () => {
    expect(VOICING_OPTIONS.map((o) => o.label)).toEqual(['Plate', 'Room']);
    expect(VOICING_OPTIONS[0]!.value).toBe(DEFAULT_REVERB.voicing);
    for (const { value } of VOICING_OPTIONS) {
      const plate = { ...DEFAULT_REVERB, voicing: value };
      const result = makeArrangement({ ...song([KICK]), returns: { a: { inserts: [plate] } } });
      expect(
        result.corrections.filter((c) => c.includes('voicing')),
        value,
      ).toEqual([]);
      expect(result.document.returns?.a?.inserts[0], value).toMatchObject({ voicing: value });
    }
  });

  it('leaves the default preset flipped to the room matching no preset', () => {
    const resident = plateSpace(DEFAULT_REVERB);
    expect(matchingReverbPreset({ ...resident, voicing: 'room' })).toBeUndefined();
  });
});

describe('tempoMatches', () => {
  const bpm = 120;
  const quarter = TEMPO_DIVISIONS.find((d) => d.label === '1/4')!;

  it('matches 1/4 at the time its button stores, and no other division', () => {
    const seconds = tempoSeconds(bpm, quarter.beats);
    expect(tempoMatches(bpm, seconds, quarter)).toBe(true);
    for (const d of TEMPO_DIVISIONS)
      if (d !== quarter) expect(tempoMatches(bpm, seconds, d)).toBe(false);
  });

  it('releases 1/4 once Time moves off it', () => {
    const moved = tempoSeconds(bpm, quarter.beats) * 1.01;
    expect(tempoMatches(bpm, moved, quarter)).toBe(false);
  });

  it('matches nothing for a return with no delay time', () => {
    expect(TEMPO_DIVISIONS.some((d) => tempoMatches(bpm, NaN, d))).toBe(false);
  });
});
