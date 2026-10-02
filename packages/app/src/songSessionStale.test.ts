/**
 * A stale tab is refused (windsor#433, tacowars 2026-10-02): two consoles
 * over one browser's storage open the same song; the first save wins, the
 * other tab's save is refused and says so, its autosave stops writing that
 * song, its edits stay open, and Save as copy… keeps them. Over shared
 * in-memory stores and fake timers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConsole } from './__fixtures__/songSessionConsole';
import { DELAY_MS, openSessionConsole } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import { STALE_SONG_TEXT } from './songSessionStorage';

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
