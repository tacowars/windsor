/**
 * A stale tab is refused (windsor#433, tacowars 2026-10-02): two consoles
 * over one browser's storage open the same song; the first save wins, the
 * other tab's save is refused and says so, its autosave stops writing that
 * song, its edits stay open, and Save as copy… keeps them. Every write is
 * checked (windsor#452): a delete or a rename based on a revision another
 * tab has saved past is refused, and a deleted song is never brought back.
 * Over shared in-memory stores and fake timers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConsole } from './__fixtures__/songSessionConsole';
import { DELAY_MS, openSessionConsole, songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import { STALE_SONG_TEXT } from './songSessionStorage';
import { CHANGED_SINCE_READ_TEXT } from './songSessionStored';

beforeAll(() => loadBuiltIns());

let a: SessionConsole;
let b: SessionConsole;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-02T09:00:00.000Z') });
  a = openSessionConsole();
  b = openSessionConsole(true, { records: a.records, store: a.store });
});
afterEach(() => vi.useRealTimers());

const bpm = (tab: SessionConsole, value: number): void =>
  void tab.ctx.change({ transport: { bpm: value } });
const storedBpm = (id: string): unknown => JSON.parse(a.records.docMap.get(id)!).transport.bpm;
const STALE = `error: ${STALE_SONG_TEXT}`;

describe('two tabs on one song', () => {
  it("refuses the stale tab's save and keeps the first tab's text", async () => {
    const id = (await a.ctx.songs.saveAs('Shared', []))!;
    expect(await b.ctx.songs.open(id)).toBe(true);
    bpm(a, 131);
    expect(await a.autosave.flush()).toBe(true);
    bpm(b, 99);
    expect(await b.autosave.flush()).toBe(false);
    expect(storedBpm(id)).toBe(131);
    expect(b.toasts).toEqual([STALE]);
    expect(b.ctx.songs.stale).toBe(true);
    expect(b.ctx.model.doc.transport.bpm).toBe(99);
    expect(b.autosave.unsaved).toBe(true);
    expect(a.ctx.songs.stale).toBe(false);
  });

  it('stops writing that song, saying so once, and keeps asking before a switch', async () => {
    const id = (await a.ctx.songs.saveAs('Shared', []))!;
    expect(await b.ctx.songs.open(id)).toBe(true);
    bpm(a, 131);
    await a.autosave.flush();
    bpm(b, 99);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    const writes = a.records.writes;
    bpm(b, 98);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect(a.records.writes).toBe(writes);
    expect(b.toasts).toEqual([STALE]);
    expect(await b.ctx.songs.newSong()).toBe(false);
    expect(b.toasts).toEqual([STALE, STALE]);
    expect(b.ctx.model.doc.transport.bpm).toBe(98);
    expect(storedBpm(id)).toBe(131);
  });

  it('Save as copy… stores the refused edits as a new song and opens it', async () => {
    const id = (await a.ctx.songs.saveAs('Shared', []))!;
    expect(await b.ctx.songs.open(id)).toBe(true);
    bpm(a, 131);
    await a.autosave.flush();
    bpm(b, 99);
    await b.autosave.flush();
    const copy = (await b.ctx.songs.saveAsCopy('Shared (mine)', []))!;
    expect(copy).not.toBeNull();
    expect(b.ctx.songs.state).toEqual({ kind: 'named', id: copy });
    expect(b.ctx.songs.stale).toBe(false);
    expect(storedBpm(copy)).toBe(99);
    bpm(b, 97);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(storedBpm(copy)).toBe(97);
    expect(storedBpm(id)).toBe(131);
    expect(b.autosave.unsaved).toBe(false);
  });

  it('lets a tab that saved go on saving: its own writes move its revision on', async () => {
    const id = (await a.ctx.songs.saveAs('Mine', []))!;
    for (const value of [121, 122, 123]) {
      bpm(a, value);
      expect(await a.autosave.flush()).toBe(true);
    }
    expect(storedBpm(id)).toBe(123);
    expect(a.records.indexMap.get(id)!.revision).toBe(4);
    expect(a.ctx.songs.stale).toBe(false);
  });
});

describe('every write checks its revision (windsor#452)', () => {
  /** B opens song `id` (once), edits it and saves: the stored song moves on a revision. */
  const bSaves = async (id: string, value: number): Promise<void> => {
    if (b.ctx.songs.state.kind === 'untitled') expect(await b.ctx.songs.open(id)).toBe(true);
    bpm(b, value);
    expect(await b.autosave.flush()).toBe(true);
  };

  it("refuses A's delete of the open song when B saved it since, and B's revision survives", async () => {
    const id = (await a.ctx.songs.saveAs('Shared', []))!;
    await bSaves(id, 131);
    const stored = [a.records.indexMap.get(id), a.records.docMap.get(id)];
    expect(await a.ctx.songs.remove(id)).toBe(false);
    expect(a.toasts).toEqual([STALE]);
    expect([a.records.indexMap.get(id), a.records.docMap.get(id)]).toEqual(stored);
    expect(a.records.indexMap.get(id)!.revision).toBe(2);
    expect(storedBpm(id)).toBe(131);
    expect(a.ctx.songs.state).toEqual({ kind: 'named', id });
    expect(a.ctx.songs.stale).toBe(true);
    expect(a.store.record).toMatchObject({ songId: id });
    // Nothing was edited, so nothing is owed.
    expect(a.autosave.unsaved).toBe(false);
  });

  it("refuses A's delete of a song it listed when B saved it since; asked again, it goes", async () => {
    await a.library.write('s', songText({ name: 'Listed', tags: [] }));
    expect((await a.ctx.songs.list()).map((entry) => entry.revision)).toEqual([1]);
    await bSaves('s', 132);
    expect(await a.ctx.songs.remove('s')).toBe(false);
    expect(a.toasts).toEqual([STALE]);
    expect(storedBpm('s')).toBe(132);
    expect(a.records.indexMap.get('s')!.revision).toBe(2);
    // A revision from the caller's own list is refused the same way.
    expect(await a.ctx.songs.remove('s', 1)).toBe(false);
    expect(a.records.docMap.has('s')).toBe(true);
    expect(await a.ctx.songs.remove('s')).toBe(true);
    expect(a.records.docMap.has('s')).toBe(false);
  });

  it("refuses A's rename of a closed song when B saves it between A's read and A's write", async () => {
    await a.library.write('s', songText({ name: 'Closed', tags: [] }));
    await bSaves('s', 133);
    const doc = a.records.doc;
    let release: () => void = () => {};
    a.records.doc = async (id) => {
      await new Promise<void>((resolve) => (release = resolve));
      return doc(id);
    };
    const renamed = a.ctx.songs.rename('s', 'Renamed');
    await vi.advanceTimersByTimeAsync(0);
    a.records.doc = doc;
    await bSaves('s', 134);
    release();
    expect(await renamed).toBe(false);
    expect(a.toasts).toEqual([`error: ${CHANGED_SINCE_READ_TEXT}`]);
    const stored = JSON.parse(a.records.docMap.get('s')!);
    expect(stored.meta.name).toBe('Closed');
    expect(stored.transport.bpm).toBe(134);
    expect(a.records.indexMap.get('s')).toMatchObject({ name: 'Closed', revision: 3 });
    // Tried again, the rename reads the song as it now is and keeps B's edit.
    expect(await a.ctx.songs.rename('s', 'Renamed')).toBe(true);
    expect(JSON.parse(a.records.docMap.get('s')!)).toMatchObject({
      meta: { name: 'Renamed' },
      transport: { bpm: 134 },
    });
  });

  it("refuses A's save of a repaired song (revision 0) that B deleted: it stays deleted", async () => {
    a.records.docMap.set('o', songText({ name: 'Orphan', tags: [] }));
    expect(await a.ctx.songs.open('o')).toBe(true);
    const listed = (await b.ctx.songs.list()).map((entry) => [entry.id, entry.revision]);
    expect(listed).toEqual([['o', 0]]);
    expect(await b.ctx.songs.remove('o')).toBe(true);
    bpm(a, 135);
    expect(await a.autosave.flush()).toBe(false);
    expect(a.toasts).toEqual([STALE]);
    expect(a.ctx.songs.stale).toBe(true);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect(a.records.docMap.has('o')).toBe(false);
    expect(a.records.indexMap.has('o')).toBe(false);
    // The edit is still A's, open and owed, for Save as copy… to keep.
    expect(a.ctx.model.doc.transport.bpm).toBe(135);
    expect(a.autosave.unsaved).toBe(true);
  });
});
