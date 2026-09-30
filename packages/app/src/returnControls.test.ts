import { DEFAULT_PLATE_REVERB, SPACES, SPACE_NAMES, plateSpace } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { TEMPO_DIVISIONS } from './mixerTables';
import { matchingSpace, tempoMatches, tempoSeconds } from './returnControls';

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
