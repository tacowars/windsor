import {
  DEFAULT_PLATE_REVERB,
  SPACES,
  SPACE_NAMES,
  makeArrangement,
  plateSpace,
} from '@windsor/engine';
import { KICK, song } from '@windsor/engine/__fixtures__/documentCases';
import { describe, expect, it } from 'vitest';
import { TEMPO_DIVISIONS } from './mixerTables';
import { VOICING_OPTIONS, matchingSpace, tempoMatches, tempoSeconds } from './returnControls';

describe('matchingSpace', () => {
  it('names every shipped space from its own numbers', () => {
    for (const name of SPACE_NAMES) expect(matchingSpace({ ...SPACES[name] })).toBe(name);
  });

  it('matches whatever order the fields come in', () => {
    const reversed = Object.fromEntries(Object.entries(SPACES.hall).reverse());
    expect(matchingSpace(reversed as typeof SPACES.hall)).toBe('hall');
  });

  it('reads a new Plate insert as its starting space, and none after a Size change', () => {
    const start = plateSpace(DEFAULT_PLATE_REVERB);
    const name = matchingSpace(start);
    expect(name).toBeDefined();
    const edited = { ...DEFAULT_PLATE_REVERB, size: DEFAULT_PLATE_REVERB.size * 1.1 };
    expect(matchingSpace(plateSpace(edited))).toBeUndefined();
    const reset = { ...edited, ...SPACES[name!] };
    expect(matchingSpace(plateSpace(reset))).toBe(name);
  });

  it('matches nothing for no space', () => {
    expect(matchingSpace(undefined)).toBeUndefined();
  });
});

describe('VOICING_OPTIONS (windsor#746)', () => {
  it('offers Plate then Room, each a voicing a song keeps, and starts on the plate', () => {
    expect(VOICING_OPTIONS.map((o) => o.label)).toEqual(['Plate', 'Room']);
    expect(VOICING_OPTIONS[0]!.value).toBe(DEFAULT_PLATE_REVERB.voicing);
    for (const { value } of VOICING_OPTIONS) {
      const plate = { ...DEFAULT_PLATE_REVERB, voicing: value };
      const result = makeArrangement({ ...song([KICK]), returns: { a: { inserts: [plate] } } });
      expect(
        result.corrections.filter((c) => c.includes('voicing')),
        value,
      ).toEqual([]);
      expect(result.document.returns?.a?.inserts[0], value).toMatchObject({ voicing: value });
    }
  });

  it('leaves a space flipped to the room matching no starting point, and the plate one its own', () => {
    const hall = plateSpace(DEFAULT_PLATE_REVERB);
    expect(matchingSpace(hall)).toBe('hall');
    expect(matchingSpace({ ...hall, voicing: 'room' })).toBeUndefined();
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
