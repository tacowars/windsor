/**
 * The session's operations on stored songs (windsor#433 decision 4): New
 * from a template, Save as copy, rename and tags on the open song and on
 * another, duplicate, and delete. Over in-memory stores and fake timers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConsole } from './__fixtures__/songSessionConsole';
import { DELAY_MS, openSessionConsole, songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import type { StoredSong } from './songAutosave';
import type { SongIndexRecord } from './songLibrary';

beforeAll(() => loadBuiltIns());

let c: SessionConsole;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-02T09:00:00.000Z') });
  c = openSessionConsole();
});
afterEach(() => vi.useRealTimers());

const bpm = (value: number): void => void c.ctx.change({ transport: { bpm: value } });

/** The two records of song `id`, to compare before and after. */
const recordsOf = (id: string): [unknown, string | undefined] => [
  structuredClone(c.records.indexMap.get(id)),
  c.records.docMap.get(id),
];

describe('newFrom', () => {
  it('opens a template as an untitled song: no name, its tags without template, the origin kept', async () => {
    await c.library.write('t', songText({ name: 'Techno kit', tags: ['template', 'techno'] }));
    const template = recordsOf('t');
    expect(await c.ctx.songs.newFrom('t')).toBe(true);
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled', origin: 'Techno kit' });
    expect(c.ctx.model.doc.meta).toEqual({ name: '', tags: ['techno'] });
    bpm(131);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect(recordsOf('t')).toEqual(template);
    expect(JSON.parse((c.store.record as StoredSong).document).transport.bpm).toBe(131);
  });
});

describe('saveAsCopy', () => {
  it("leaves the original's records byte-identical and opens the copy", async () => {
    const a = (await c.ctx.songs.saveAs('A', ['dub']))!;
    await vi.advanceTimersByTimeAsync(DELAY_MS * 2);
    const original = recordsOf(a);
    bpm(126);
    const copy = (await c.ctx.songs.saveAsCopy('A copy', ['dub', 'live']))!;
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect(recordsOf(a)).toEqual(original);
    expect(copy).not.toBe(a);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: copy });
    const doc = JSON.parse(c.records.docMap.get(copy)!);
    expect(doc.meta).toEqual({ name: 'A copy', tags: ['dub', 'live'] });
    expect(doc.transport.bpm).toBe(126);
    expect(c.store.record).toMatchObject({ songId: copy });
  });
});

describe('rename and setTags', () => {
  it('renames the open song as an undoable edit, and the store follows on its next autosave', async () => {
    const a = (await c.ctx.songs.saveAs('Old', []))!;
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(await c.ctx.songs.rename(a, 'New')).toBe(true);
    expect(c.ctx.model.doc.meta?.name).toBe('New');
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(c.records.indexMap.get(a)?.name).toBe('New');
    expect(c.ctx.undoLabel).toBe('Song name');
    expect(c.ctx.undo()).toBe(true);
    expect(c.ctx.model.doc.meta?.name).toBe('Old');
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(c.records.indexMap.get(a)?.name).toBe('Old');
    expect(JSON.parse(c.records.docMap.get(a)!).meta.name).toBe('Old');
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
  });

  it('sets the open song’s tags as an undoable edit', async () => {
    const a = (await c.ctx.songs.saveAs('Song', ['one']))!;
    expect(await c.ctx.songs.setTags(a, ['Two', 'three'])).toBe(true);
    expect(c.ctx.model.doc.meta?.tags).toEqual(['two', 'three']);
    expect(c.ctx.undoLabel).toBe('Song tags');
  });

  it("writes another song's new name and tags into its text, leaving the open song alone", async () => {
    const open = (await c.ctx.songs.saveAs('Open', []))!;
    const other = songText({ name: 'Other', tags: [] }, { bpm: 90 });
    await c.library.write('o', other);
    const doc = c.ctx.model.toJson();
    expect(await c.ctx.songs.rename('o', '  Renamed  ')).toBe(true);
    expect(await c.ctx.songs.setTags('o', ['House'])).toBe(true);
    const stored = c.records.docMap.get('o')!;
    expect(JSON.parse(stored).meta).toEqual({ name: 'Renamed', tags: ['house'] });
    expect({ ...JSON.parse(stored), meta: undefined }).toEqual({
      ...JSON.parse(other),
      meta: undefined,
    });
    expect(c.records.indexMap.get('o')).toMatchObject({ name: 'Renamed', tags: ['house'] });
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: open });
    expect(c.ctx.model.toJson()).toBe(doc);
  });
});

describe('duplicate', () => {
  it('stores a copy named "<name> copy" and keeps the open song', async () => {
    const open = (await c.ctx.songs.saveAs('Open', []))!;
    await c.library.write('o', songText({ name: 'Groove', tags: ['funk'] }));
    const copy = (await c.ctx.songs.duplicate('o'))!;
    expect(copy).not.toBe('o');
    expect(JSON.parse(c.records.docMap.get(copy)!).meta).toEqual({
      name: 'Groove copy',
      tags: ['funk'],
    });
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: open });
  });
});

describe('remove', () => {
  it('leaves the open song open and untitled, with its text back in current at once', async () => {
    const a = (await c.ctx.songs.saveAs('Doomed', []))!;
    bpm(117);
    const doc = c.ctx.model.toJson();
    expect(await c.ctx.songs.remove(a)).toBe(true);
    expect(c.ctx.model.toJson()).toBe(doc);
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
    expect(c.store.record).toEqual({ updated: expect.any(String), document: doc });
    expect(c.records.docMap.has(a)).toBe(false);
    expect(c.records.indexMap.has(a)).toBe(false);
    // No late autosave brings the deleted song back.
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect(c.records.docMap.has(a)).toBe(false);
  });

  it('waits for writes already captured for the open song, so none brings it back', async () => {
    const a = (await c.ctx.songs.saveAs('Queued', []))!;
    const put = c.records.put;
    const held: (() => void)[] = [];
    c.records.put = (id, text, next) =>
      new Promise<SongIndexRecord>((resolve, reject) => {
        held.push(() => void put(id, text, next).then(resolve, reject));
      });
    bpm(118);
    void c.autosave.flush();
    bpm(119);
    void c.autosave.flush();
    const removed = c.ctx.songs.remove(a);
    await vi.advanceTimersByTimeAsync(0);
    while (held.length > 0) {
      held.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(await removed).toBe(true);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect((await c.ctx.songs.list()).map((entry) => entry.id)).not.toContain(a);
    expect(await c.library.read(a)).toBeNull();
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
  });

  it('removes another song and leaves the open one alone', async () => {
    const a = (await c.ctx.songs.saveAs('Kept', []))!;
    await c.library.write('o', songText({ name: 'Gone', tags: [] }));
    const doc = c.ctx.model.toJson();
    expect(await c.ctx.songs.remove('o')).toBe(true);
    expect(c.records.docMap.has('o')).toBe(false);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(c.ctx.model.toJson()).toBe(doc);
    expect(c.store.record).toMatchObject({ songId: a });
  });
});
