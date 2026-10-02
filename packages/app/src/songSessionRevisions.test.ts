/**
 * The revisions a tab has seen (windsor#452): its list, its own writes and
 * deletes keep them, and a delete refused as stale forgets its basis.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { memorySongRecords } from './__fixtures__/memorySongStores';
import { songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import { StaleSongError, songLibrary } from './songLibrary';
import { seenRevisions } from './songSessionRevisions';

beforeAll(() => loadBuiltIns());

describe('seenRevisions', () => {
  it('records the revisions its list shows and its writes make, and forgets a delete', async () => {
    const records = memorySongRecords();
    const other = songLibrary(records);
    const { library, revision } = seenRevisions(songLibrary(records));
    await other.write('a', songText());
    expect(revision('a')).toBeUndefined();
    await library.list();
    expect(revision('a')).toBe(1);
    await library.write('a', songText({ name: 'Two', tags: [] }), 1);
    expect(revision('a')).toBe(2);
    await library.remove('a', 2);
    expect(revision('a')).toBeUndefined();
  });

  it('forgets the basis of a delete refused as stale, and keeps the song', async () => {
    const records = memorySongRecords();
    const other = songLibrary(records);
    const { library, revision } = seenRevisions(songLibrary(records));
    await library.write('a', songText());
    await other.write('a', songText({ name: 'Theirs', tags: [] }), 1);
    await expect(library.remove('a', 1)).rejects.toThrow(StaleSongError);
    expect(revision('a')).toBeUndefined();
    expect(records.docMap.has('a')).toBe(true);
  });
});
