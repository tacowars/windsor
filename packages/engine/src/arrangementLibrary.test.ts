/**
 * The library (#435): every `arrangements/*.json` keyed by file name, and the
 * selection the query string makes from it. An unknown name resolves to no
 * document — `installMusicControls` turns that into the logged fallback.
 */
import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_LIBRARY, ARRANGEMENT_NAMES, selectMusic } from './arrangementLibrary';
import bed01 from './arrangements/bed-01.json';
import { DEFAULT_ARRANGEMENT_NAME } from './audioConstants';

describe('ARRANGEMENT_LIBRARY', () => {
  it('keys each committed document by its file name', () => {
    expect(ARRANGEMENT_NAMES).toContain('bed-01');
    expect(ARRANGEMENT_LIBRARY['bed-01']).toEqual(bed01);
  });
});

describe('selectMusic', () => {
  const library = { 'bed-01': { seed: 1 }, night: { seed: 2 } };

  it('plays the default, enabled, with no query', () => {
    expect(selectMusic('', library)).toEqual({
      enabled: true,
      name: DEFAULT_ARRANGEMENT_NAME,
      raw: library['bed-01'],
    });
  });

  it('picks a named document and keeps it under ?music=0 for the suppressed graph', () => {
    expect(selectMusic('?music=night', library)).toEqual({
      enabled: true,
      name: 'night',
      raw: library.night,
    });
    expect(selectMusic('?music=0', library).enabled).toBe(false);
  });

  it('resolves an unknown name to no document rather than a stand-in', () => {
    const missing = selectMusic('?music=bed-99', library);
    expect(missing.name).toBe('bed-99');
    expect(missing.raw).toBeUndefined();
  });
});
