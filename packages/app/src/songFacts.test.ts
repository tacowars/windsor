/**
 * The song library's index fields (windsor#433 decision 1): one pure
 * function of the document text, read as written.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ARRANGEMENT_VERSION } from '@windsor/engine';
import { songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import { songFacts } from './songFacts';

beforeAll(() => loadBuiltIns());

describe('songFacts', () => {
  it('reads the version, name, tags, bpm, meter, bars and key from the text', () => {
    const text = songText({ name: 'Night Drive', tags: ['techno', 'template'] }, { bpm: 128 });
    expect(songFacts(text)).toEqual({
      version: ARRANGEMENT_VERSION,
      name: 'Night Drive',
      tags: ['techno', 'template'],
      bpm: 128,
      meter: '4/4',
      bars: 4,
      key: { root: 0, scale: 'naturalMinor' },
    });
  });

  it("indexes a song with no transport.meter as '4/4', and a 7/8 song as '7/8'", () => {
    const plain = songText();
    expect(JSON.parse(plain).transport.meter).toBeUndefined();
    expect(songFacts(plain).meter).toBe('4/4');
    expect(songFacts(songText(undefined, { meter: '7/8' })).meter).toBe('7/8');
  });

  it('reads an empty name and no tags when the song has no meta', () => {
    const facts = songFacts(songText());
    expect(facts.name).toBe('');
    expect(facts.tags).toEqual([]);
  });

  it('reads a song this build cannot open as written, and junk as empty', () => {
    const future = JSON.stringify({ version: 99, meta: { name: 'Later', tags: ['x'] } });
    expect(songFacts(future)).toMatchObject({ version: 99, name: 'Later', tags: ['x'] });
    expect(songFacts('not json')).toEqual({
      version: null,
      name: '',
      tags: [],
      bpm: null,
      meter: '4/4',
      bars: null,
      key: null,
    });
  });
});
