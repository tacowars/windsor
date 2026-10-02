/**
 * The open-song session (windsor#433 decisions 3–7): Save as names and
 * stores the untitled song, a named song autosaves into its own records,
 * a switch flushes the song being left and stops when that fails, a
 * repaired open writes nothing, and every other replacement is untitled.
 * Over in-memory stores and fake timers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConsole } from './__fixtures__/songSessionConsole';
import { DELAY_MS, openSessionConsole, songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import { isNamedSession } from './songAutosave';
import type { StoredSong } from './songAutosave';
import { newSong } from './songParts';

beforeAll(() => loadBuiltIns());

let c: SessionConsole;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-02T09:00:00.000Z') });
  c = openSessionConsole();
});
afterEach(() => vi.useRealTimers());

/** Store a song directly, as an earlier session would have. */
const stored = async (id: string, text: string): Promise<void> => {
  await c.library.write(id, text);
};

const bpm = (value: number): void => void c.ctx.change({ transport: { bpm: value } });

describe('saveAs', () => {
  it('stores the untitled song under one id, with its name and tags in the document', async () => {
    const id = await c.ctx.songs.saveAs('Night Drive', ['techno']);
    expect(id).not.toBeNull();
    expect([...c.records.indexMap.keys()]).toEqual([id]);
    expect([...c.records.docMap.keys()]).toEqual([id]);
    const doc = JSON.parse(c.records.docMap.get(id!)!);
    expect(doc.meta).toEqual({ name: 'Night Drive', tags: ['techno'] });
    expect(c.records.indexMap.get(id!)).toMatchObject({ name: 'Night Drive', tags: ['techno'] });
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id });
    expect(c.store.record).toEqual({ updated: expect.any(String), songId: id });
  });

  it('names the song as one undoable edit', async () => {
    await c.ctx.songs.saveAs('Night Drive', ['techno']);
    expect(c.ctx.undoLabel).toBe('Song name');
    expect(c.ctx.undo()).toBe(true);
    expect(c.ctx.model.doc.meta).toBeUndefined();
  });

  it('autosaves an edit to the named song into its records, never into current', async () => {
    const id = (await c.ctx.songs.saveAs('Night Drive', []))!;
    const before = c.records.indexMap.get(id)!.updated;
    const current = c.store.saves.length;
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    bpm(133);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(JSON.parse(c.records.docMap.get(id)!).transport.bpm).toBe(133);
    expect(c.records.indexMap.get(id)!.bpm).toBe(133);
    expect(c.records.indexMap.get(id)!.updated > before).toBe(true);
    expect(c.store.saves.slice(current).some((record) => !isNamedSession(record))).toBe(false);
    expect(c.store.record).toEqual({ updated: expect.any(String), songId: id });
  });

  it('keeps the song untitled, and reports, when the store refuses', async () => {
    c.records.failing = true;
    expect(await c.ctx.songs.saveAs('Lost', [])).toBeNull();
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
    expect(c.toasts).toContain('error: save failed: quota');
  });
});

describe('open', () => {
  it("flushes A's pending change into A before B opens, and leaves B's record alone", async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    const bText = songText({ name: 'B', tags: [] });
    await stored('b', bText);
    const bIndex = c.records.indexMap.get('b');
    bpm(140);
    await vi.advanceTimersByTimeAsync(DELAY_MS / 2);
    expect(await c.ctx.songs.open('b')).toBe(true);
    expect(JSON.parse(c.records.docMap.get(a)!).transport.bpm).toBe(140);
    expect(c.records.docMap.get('b')).toBe(bText);
    expect(c.records.indexMap.get('b')).toBe(bIndex);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: 'b' });
    expect(c.ctx.model.doc.meta?.name).toBe('B');
    expect(c.store.record).toMatchObject({ songId: 'b' });
    await vi.advanceTimersByTimeAsync(DELAY_MS * 5);
    expect(c.records.docMap.get('b')).toBe(bText);
  });

  it('stops the switch when the flush of A is rejected: A stays open with its edits', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    await stored('b', songText({ name: 'B', tags: [] }));
    bpm(150);
    c.records.failing = true;
    expect(await c.ctx.songs.open('b')).toBe(false);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(c.ctx.model.doc.meta?.name).toBe('A');
    expect(c.ctx.model.doc.transport.bpm).toBe(150);
    expect(c.toasts).toContain("error: A stays open: its last changes couldn't be saved");
    // The edit is still owed to A, and lands there once the store takes writes again.
    c.records.failing = false;
    await c.autosave.flush();
    expect(JSON.parse(c.records.docMap.get(a)!).transport.bpm).toBe(150);
  });

  it('writes nothing back after opening a song the normaliser corrected, until an edit', async () => {
    const raw = songText({ name: 'Wild', tags: [] }).replace('"bpm": 120', '"bpm": 9999');
    await stored('wild', raw);
    const writes = c.records.writes;
    expect(await c.ctx.songs.open('wild')).toBe(true);
    expect(c.ctx.model.corrections).not.toEqual([]);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 5);
    expect(c.records.writes).toBe(writes);
    expect(c.records.docMap.get('wild')).toBe(raw);
    bpm(124);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(JSON.parse(c.records.docMap.get('wild')!).transport.bpm).toBe(124);
  });

  it('refuses a future-format song and writes nothing; its text exports as stored', async () => {
    const future = JSON.stringify({ version: 99, meta: { name: 'Later', tags: [] } });
    await stored('later', future);
    const writes = c.records.writes;
    const list = await c.ctx.songs.list();
    expect(list.find((entry) => entry.id === 'later')?.refusal).not.toBeNull();
    const doc = c.ctx.model.toJson();
    expect(await c.ctx.songs.open('later')).toBe(false);
    expect(c.toasts.at(-1)).toMatch(/^error: import refused: Later was .*The file is unchanged\.$/);
    expect(c.ctx.model.toJson()).toBe(doc);
    expect(c.ctx.songs.state.kind).toBe('untitled');
    expect(await c.ctx.songs.newFrom('later')).toBe(false);
    expect(c.records.writes).toBe(writes);
    expect(c.records.docMap.get('later')).toBe(future);
    expect(await c.ctx.songs.exportText('later')).toBe(future);
  });
});

describe('the untitled switches', () => {
  it('sets the session untitled on New song, and on an import', async () => {
    await c.ctx.songs.saveAs('A', []);
    await c.ctx.importDoc(newSong());
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
    await c.ctx.songs.saveAs('B', []);
    expect(await c.ctx.songs.newSong()).toBe(true);
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
    expect(c.ctx.model.doc.meta).toBeUndefined();
  });

  it('names an imported song with no name after its file, as an edit of the open', async () => {
    await c.ctx.importDoc(newSong(), 'Warehouse Jam.json');
    expect(c.ctx.model.doc.meta).toEqual({ name: 'Warehouse Jam', tags: [] });
    expect(c.ctx.model.changed).toBe(true);
    await c.ctx.importDoc(JSON.parse(songText({ name: 'Own', tags: ['x'] })), 'other.json');
    expect(c.ctx.model.doc.meta).toEqual({ name: 'Own', tags: ['x'] });
  });

  it('imports through the session after flushing, and refuses a future-format file', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    bpm(111);
    expect(await c.ctx.songs.importText(songText(), 'loop.json')).toBe(true);
    expect(JSON.parse(c.records.docMap.get(a)!).transport.bpm).toBe(111);
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
    expect(c.ctx.model.doc.meta?.name).toBe('loop');
    expect(await c.ctx.songs.importText('{"version": 99}', 'later.json')).toBe(false);
    expect(c.toasts.at(-1)).toMatch(/^error: import refused: later\.json was /);
  });

  it("points current at the new untitled song's text at once when a named song is left", async () => {
    await c.ctx.songs.saveAs('A', []);
    await c.ctx.importDoc(newSong(), 'next.json');
    await vi.advanceTimersByTimeAsync(0);
    expect((c.store.record as StoredSong).document).toBe(c.ctx.model.toJson());
  });

  it('keeps New song from leaving a named song whose changes cannot be saved', async () => {
    await c.ctx.songs.saveAs('A', []);
    bpm(99);
    c.records.failing = true;
    expect(await c.ctx.songs.newSong()).toBe(false);
    expect(c.ctx.model.doc.meta?.name).toBe('A');
    expect(c.ctx.model.doc.transport.bpm).toBe(99);
  });

  it('asks before leaving only a changed untitled song', async () => {
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(false);
    bpm(101);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(true);
    await c.ctx.songs.saveAs('A', []);
    bpm(102);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(false);
  });
});

describe('without IndexedDB', () => {
  it('is unavailable, lists nothing, and imports as before', async () => {
    const bare = openSessionConsole(false);
    expect(bare.ctx.songs.available).toBe(false);
    expect(await bare.ctx.songs.list()).toEqual([]);
    expect(await bare.ctx.songs.saveAs('A', [])).toBeNull();
    await bare.ctx.importDoc(JSON.parse(songText(undefined, { bpm: 97 })));
    expect(bare.ctx.model.doc.transport.bpm).toBe(97);
    expect(bare.ctx.songs.state).toEqual({ kind: 'untitled' });
  });
});
