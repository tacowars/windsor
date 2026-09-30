import { describe, expect, it } from 'vitest';
import { DEFAULT_MASTER, makeArrangement } from '@windsor/engine';
import { FULL_DOCUMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { MASTER_LEVEL_FADER, amplitudeDb } from './masterTables';
import { insertChange } from './insertTarget';
import { DEFAULT_DRIVE } from '@windsor/engine';
describe('master controls', () => {
  it('uses the engine default and dBFS scale', () => {
    expect(MASTER_LEVEL_FADER.def).toBe(DEFAULT_MASTER.level);
    expect(amplitudeDb(1)).toBe(0);
    expect(amplitudeDb(0.5)).toBeCloseTo(-6.0206);
    expect(Number.isFinite(amplitudeDb(0))).toBe(true);
  });
  it('routes the same insert edit into master or a track and retains master data on export', () => {
    const change = insertChange('master', [DEFAULT_DRIVE]);
    expect(change).toEqual({ master: { inserts: [DEFAULT_DRIVE] } });
    expect(insertChange(2, [DEFAULT_DRIVE])).toEqual({
      parts: { 2: { strip: { inserts: [DEFAULT_DRIVE] } } },
    });
    const song = makeArrangement({
      ...FULL_DOCUMENT,
      master: { level: 0.5, inserts: [DEFAULT_DRIVE] },
    }).document;
    expect(makeArrangement(JSON.parse(JSON.stringify(song))).document.master).toEqual(song.master);
  });
});
