/**
 * The named songs' storage (windsor#433 decisions 1, 2, 8 and 10): both
 * records written together, the index derived from the text with `created`
 * kept, the list judged from the index alone, and the index repaired or
 * dropped to follow the documents. Every write and delete is checked
 * against the song as stored (windsor#452).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySessionStore, memorySongRecords } from './__fixtures__/memorySongStores';
import { songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import { songFacts } from './songFacts';
import { NEW_SONG, StaleSongError, songLibrary, versionRefusal } from './songLibrary';

const T0 = new Date('2026-10-02T09:00:00.000Z');
const FUTURE = JSON.stringify({ version: 99, meta: { name: 'From later', tags: [] } }, null, 2);

beforeAll(() => loadBuiltIns());

describe('songLibrary', () => {
  beforeEach(() => vi.useFakeTimers({ now: T0 }));
  afterEach(() => vi.useRealTimers());

  it('writes the index and the document under one id, the index derived from the text', async () => {
    const records = memorySongRecords();
    const library = songLibrary(records);
    const text = songText({ name: 'Acid', tags: ['techno'] });
    const index = await library.write('a', text);
    expect(records.docMap.get('a')).toBe(text);
    expect(records.indexMap.get('a')).toEqual(index);
    expect(index).toEqual({
      ...songFacts(text),
      id: 'a',
      created: T0.toISOString(),
      updated: T0.toISOString(),
      revision: 1,
    });
    expect(await library.read('a')).toBe(text);
  });

  it('keeps created and moves updated on a rewrite', async () => {
    const library = songLibrary(memorySongRecords());
    await library.write('a', songText({ name: 'One', tags: [] }));
    vi.advanceTimersByTime(60_000);
    const later = await library.write('a', songText({ name: 'Two', tags: [] }), 1);
    expect(later.created).toBe(T0.toISOString());
    expect(later.updated).toBe(new Date(T0.getTime() + 60_000).toISOString());
    expect(later.name).toBe('Two');
  });

  it('marks only the future-format song unopenable, from the index, without reading a document', async () => {
    const records = memorySongRecords();
    const library = songLibrary(records);
    await library.write('now', songText({ name: 'Now', tags: [] }));
    await library.write('later', FUTURE);
    records.docReads.length = 0;
    const list = await library.list();
    expect(records.docReads).toEqual([]);
    const byId = new Map(list.map((entry) => [entry.id, entry]));
    expect(byId.get('now')?.refusal).toBeNull();
    expect(byId.get('later')?.refusal).toEqual(versionRefusal(99));
    expect(byId.get('later')?.refusal?.message).toMatch(/99/);
  });

  it('drops an index record whose document is missing', async () => {
    const records = memorySongRecords();
    const library = songLibrary(records);
    await library.write('kept', songText({ name: 'Kept', tags: [] }));
    await library.write('lost', songText({ name: 'Lost', tags: [] }));
    records.docMap.delete('lost');
    expect((await library.list()).map((entry) => entry.id)).toEqual(['kept']);
  });

  it('re-derives a missing index record from its document, and writes the repair', async () => {
    const records = memorySongRecords();
    const library = songLibrary(records);
    const text = songText({ name: 'Orphan', tags: ['dub'] }, { bpm: 90 });
    records.docMap.set('o', text);
    const list = await library.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'o', name: 'Orphan', tags: ['dub'], bpm: 90 });
    expect(records.indexMap.get('o')).toMatchObject({ id: 'o', name: 'Orphan' });
  });

  it('removes both records', async () => {
    const records = memorySongRecords();
    const library = songLibrary(records);
    await library.write('a', songText());
    await library.remove('a', 1);
    expect(records.docMap.size).toBe(0);
    expect(records.indexMap.size).toBe(0);
    expect(await library.list()).toEqual([]);
  });

  describe('revisions: a stale save is refused (tacowars, 2026-10-02)', () => {
    it('bumps the revision on every write and loads the text with it', async () => {
      const library = songLibrary(memorySongRecords());
      expect((await library.write('a', songText())).revision).toBe(1);
      const text = songText({ name: 'Two', tags: [] });
      expect((await library.write('a', text, 1)).revision).toBe(2);
      expect(await library.load('a')).toEqual({ text, revision: 2 });
      expect(await library.load('none')).toBeNull();
    });

    it('refuses a save based on a revision the song has moved on from, writing nothing', async () => {
      const records = memorySongRecords();
      const library = songLibrary(records);
      await library.write('a', songText({ name: 'One', tags: [] }));
      const theirs = songText({ name: 'Theirs', tags: [] });
      await library.write('a', theirs, 1);
      const stored = records.indexMap.get('a');
      await expect(library.write('a', songText({ name: 'Mine', tags: [] }), 1)).rejects.toThrow(
        StaleSongError,
      );
      expect(records.docMap.get('a')).toBe(theirs);
      expect(records.indexMap.get('a')).toBe(stored);
    });

    it('refuses a save to a song deleted since it was read, and indexes a repaired song at 0', async () => {
      const records = memorySongRecords();
      const library = songLibrary(records);
      await library.write('a', songText());
      await library.remove('a', 1);
      await expect(library.write('a', songText(), 1)).rejects.toThrow(StaleSongError);
      records.docMap.set('o', songText());
      expect((await library.load('o'))?.revision).toBe(0);
      await library.list();
      expect(records.indexMap.get('o')?.revision).toBe(0);
      expect((await library.write('o', songText(), 0)).revision).toBe(1);
    });

    it('never takes a missing song for revision 0: a repaired song deleted since is not brought back', async () => {
      const records = memorySongRecords();
      const library = songLibrary(records);
      records.docMap.set('o', songText());
      expect((await library.load('o'))?.revision).toBe(0);
      await library.remove('o', 0);
      await expect(library.write('o', songText(), 0)).rejects.toThrow(StaleSongError);
      expect(records.docMap.has('o')).toBe(false);
      expect(records.indexMap.has('o')).toBe(false);
    });

    it('creates only with NEW_SONG, the default, and never over a song that exists', async () => {
      const records = memorySongRecords();
      const library = songLibrary(records);
      const first = songText({ name: 'First', tags: [] });
      expect((await library.write('a', first, NEW_SONG)).revision).toBe(1);
      await expect(library.write('a', songText())).rejects.toThrow(StaleSongError);
      expect(records.docMap.get('a')).toBe(first);
      // An index a lost document left behind doesn't stop the id's creation, and isn't carried on.
      records.docMap.delete('a');
      expect((await library.write('a', songText(), NEW_SONG)).revision).toBe(1);
    });

    it('refuses to delete a song saved since the revision the delete is based on, changing nothing', async () => {
      const records = memorySongRecords();
      const library = songLibrary(records);
      await library.write('a', songText());
      const theirs = songText({ name: 'Theirs', tags: [] });
      const index = await library.write('a', theirs, 1);
      await expect(library.remove('a', 1)).rejects.toThrow(StaleSongError);
      expect(records.docMap.get('a')).toBe(theirs);
      expect(records.indexMap.get('a')).toBe(index);
      // A song already gone deletes nothing more.
      await library.remove('a', 2);
      await expect(library.remove('a', 2)).resolves.toBeUndefined();
    });

    it("repairs an index only while the song still has none, so it never rolls a save's revision back", async () => {
      const records = memorySongRecords();
      const library = songLibrary(records);
      records.docMap.set('o', songText());
      const doc = records.doc;
      // Another tab saves the repaired song while this list reads its document.
      records.doc = async (id) => {
        const text = await doc(id);
        await library.write('o', songText({ name: 'Saved', tags: [] }), 0);
        return text;
      };
      await library.list();
      expect(records.indexMap.get('o')).toMatchObject({ name: 'Saved', revision: 1 });
    });
  });

  describe("the open song's delete", () => {
    it('deletes both records and writes current in one transaction', async () => {
      const session = memorySessionStore();
      const records = memorySongRecords(session);
      const library = songLibrary(records);
      await library.write('a', songText());
      const current = { updated: T0.toISOString(), document: songText() };
      await library.removeOpen('a', current, 1);
      expect(session.record).toBe(current);
      expect(records.docMap.has('a')).toBe(false);
    });

    it('changes nothing when the write to current is refused', async () => {
      const session = memorySessionStore({ updated: T0.toISOString(), songId: 'a' });
      const records = memorySongRecords(session);
      const library = songLibrary(records);
      await library.write('a', songText());
      session.failing = true;
      await expect(
        library.removeOpen('a', { updated: T0.toISOString(), document: '{}' }, 1),
      ).rejects.toThrow('quota');
      expect(session.record).toEqual({ updated: T0.toISOString(), songId: 'a' });
      expect(records.docMap.has('a')).toBe(true);
      expect(records.indexMap.has('a')).toBe(true);
    });

    it('is refused when the song was saved since its revision, and writes neither current nor the song', async () => {
      const session = memorySessionStore({ updated: T0.toISOString(), songId: 'a' });
      const records = memorySongRecords(session);
      const library = songLibrary(records);
      await library.write('a', songText());
      const theirs = songText({ name: 'Theirs', tags: [] });
      await library.write('a', theirs, 1);
      await expect(
        library.removeOpen('a', { updated: T0.toISOString(), document: '{}' }, 1),
      ).rejects.toThrow(StaleSongError);
      expect(session.record).toEqual({ updated: T0.toISOString(), songId: 'a' });
      expect(records.docMap.get('a')).toBe(theirs);
      expect(records.indexMap.get('a')?.revision).toBe(2);
    });
  });
});
