/**
 * The one switch (windsor#433, record `2026-10-02-song-library`, "One
 * switch"): every replacement of the open document drains the song being
 * left and stops when that fails, a retarget never drops a write still
 * owed, and deleting the open song is one transaction that leaves a
 * committed copy either way. Over in-memory stores and fake timers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConsole } from './__fixtures__/songSessionConsole';
import { DELAY_MS, openSessionConsole, songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import type { StoredSong } from './songAutosave';

beforeAll(() => loadBuiltIns());

let c: SessionConsole;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-02T09:00:00.000Z') });
  c = openSessionConsole();
});
afterEach(() => vi.useRealTimers());

const bpm = (value: number): void => void c.ctx.change({ transport: { bpm: value } });
const storedBpm = (id: string): unknown => JSON.parse(c.records.docMap.get(id)!).transport.bpm;
const STAYS_OPEN = "error: A stays open: its last changes couldn't be saved";

describe('an import through the real paths, while the named song cannot be saved', () => {
  it('ctx.importDoc stops: the named song keeps its edits, stays open, and stores them later', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    bpm(150);
    c.records.failing = true;
    const other = JSON.parse(songText({ name: 'Other', tags: [] })) as unknown;
    expect(await c.ctx.importDoc(other, 'other.json')).toBe(false);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(c.ctx.model.doc.meta?.name).toBe('A');
    expect(c.ctx.model.doc.transport.bpm).toBe(150);
    expect(c.toasts).toContain(STAYS_OPEN);
    expect(c.autosave.unsaved).toBe(true);
    c.records.failing = false;
    expect(await c.autosave.flush()).toBe(true);
    expect(storedBpm(a)).toBe(150);
  });

  it('the Import button’s importText and New song stop the same way', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    bpm(151);
    c.records.failing = true;
    expect(await c.ctx.songs.importText(songText(), 'loop.json')).toBe(false);
    expect(await c.ctx.songs.newSong()).toBe(false);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(c.ctx.model.doc.transport.bpm).toBe(151);
    c.records.failing = false;
    await c.autosave.flush();
    expect(storedBpm(a)).toBe(151);
  });

  it('drains an edit made while the switch waits, into the song being left', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    const imported = c.ctx.importDoc(JSON.parse(songText()), 'next.json');
    bpm(152);
    expect(await imported).toBe(true);
    expect(storedBpm(a)).toBe(152);
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
  });
});

describe('a retarget never drops a write still owed', () => {
  it('failed autosave, failed delete, storage back: the flush retries and stores the edit', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    bpm(140);
    c.records.failing = true;
    expect(await c.autosave.flush()).toBe(false);
    expect(await c.ctx.songs.remove(a)).toBe(false);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    c.records.failing = false;
    expect(c.autosave.unsaved).toBe(true);
    expect(await c.autosave.flush()).toBe(true);
    expect(storedBpm(a)).toBe(140);
    expect(c.autosave.unsaved).toBe(false);
  });

  it('a write owed when the delete’s transaction fails goes to the song afterwards', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    const deleteInto = c.records.deleteInto;
    let fail: () => void = () => {};
    c.records.deleteInto = (): Promise<void> =>
      new Promise<void>((_, reject) => {
        fail = (): void => reject(new Error('quota'));
      });
    const removed = c.ctx.songs.remove(a);
    await vi.advanceTimersByTimeAsync(0);
    // An edit while the transaction runs is sent to current, and that write fails too.
    c.store.failing = true;
    bpm(141);
    expect(await c.autosave.flush()).toBe(false);
    fail();
    expect(await removed).toBe(false);
    c.records.deleteInto = deleteInto;
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(c.autosave.unsaved).toBe(true);
    expect(await c.autosave.flush()).toBe(true);
    expect(storedBpm(a)).toBe(141);
  });

  it('a delete that fails while its edit lands in current keeps the edit owed to the song (windsor#452)', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    const deleteInto = c.records.deleteInto;
    let fail: () => void = () => {};
    c.records.deleteInto = (): Promise<void> =>
      new Promise<void>((_, reject) => {
        fail = (): void => reject(new Error('quota'));
      });
    const removed = c.ctx.songs.remove(a);
    await vi.advanceTimersByTimeAsync(0);
    // The edit's write to current succeeds while the delete's transaction is still running.
    bpm(142);
    expect(await c.autosave.flush()).toBe(true);
    expect((c.store.record as StoredSong).document).toBe(c.ctx.model.toJson());
    fail();
    expect(await removed).toBe(false);
    c.records.deleteInto = deleteInto;
    expect(c.toasts.at(-1)).toBe('error: delete failed: quota');
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(c.autosave.unsaved).toBe(true);
    // current keeps the edit until the song's record holds it, then names the song again.
    expect(storedBpm(a)).not.toBe(142);
    expect((c.store.record as StoredSong).document).toBe(c.ctx.model.toJson());
    expect(await c.autosave.flush()).toBe(true);
    expect(storedBpm(a)).toBe(142);
    expect(c.store.record).toMatchObject({ songId: a });
    expect(c.autosave.unsaved).toBe(false);
  });

  it('a delete that fails with nothing edited meanwhile owes nothing', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    c.store.failing = true;
    expect(await c.ctx.songs.remove(a)).toBe(false);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(c.autosave.unsaved).toBe(false);
  });
});

describe('deleting the open song is one transaction', () => {
  it('when the write to current is refused, the named records stay and the song stays named', async () => {
    const a = (await c.ctx.songs.saveAs('A', ['dub']))!;
    bpm(133);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    const records = [c.records.indexMap.get(a), c.records.docMap.get(a)];
    const current = c.store.record;
    c.store.failing = true;
    expect(await c.ctx.songs.remove(a)).toBe(false);
    expect([c.records.indexMap.get(a), c.records.docMap.get(a)]).toEqual(records);
    expect(c.store.record).toBe(current);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(c.toasts.at(-1)).toBe('error: delete failed: quota');
  });

  it('writes current and deletes both records together on success', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    bpm(134);
    const writes = c.records.writes;
    expect(await c.ctx.songs.remove(a)).toBe(true);
    // The drain's write into A, then the one transaction.
    expect(c.records.writes).toBe(writes + 2);
    expect((c.store.record as StoredSong).document).toBe(c.ctx.model.toJson());
    expect(c.records.docMap.has(a)).toBe(false);
    expect(c.autosave.unsaved).toBe(false);
  });
});
