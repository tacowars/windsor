/**
 * The recovery copy in `current` (windsor#452): when the open song's delete
 * fails or is refused after an edit landed in `current` while it ran, that
 * edit is owed to the song's record, and `current` keeps the whole text
 * until the owed write has landed there. A reload before then restores the
 * edit, never the older named record. Over shared in-memory stores, a fresh
 * boot standing for the reload, and fake timers.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionConsole } from './__fixtures__/songSessionConsole';
import { DELAY_MS, openSessionConsole } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import type { StoredSong } from './songAutosave';
import { touchWatch } from './songRestore';
import { STALE_SONG_TEXT } from './songSessionStorage';
import { bootSongs } from './userSessionSongs';

beforeAll(() => loadBuiltIns());

let c: SessionConsole;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-02T09:00:00.000Z') });
  c = openSessionConsole();
});
afterEach(() => vi.useRealTimers());

const bpm = (tab: SessionConsole, value: number): void =>
  void tab.ctx.change({ transport: { bpm: value } });
const storedBpm = (id: string): unknown => JSON.parse(c.records.docMap.get(id)!).transport.bpm;
const currentBpm = (): unknown => JSON.parse((c.store.record as StoredSong).document).transport.bpm;

/**
 * Delete the open song `id` with its transaction held open, land an edit
 * (`value`) in `current` meanwhile, then let the transaction run (`outcome`
 * 'fail' rejects it, 'run' hands it to the stores); resolves the delete's result.
 */
async function deleteWithEditLanded(
  id: string,
  value: number,
  outcome: 'fail' | 'run',
): Promise<boolean> {
  const deleteInto = c.records.deleteInto;
  let release: () => void = () => {};
  c.records.deleteInto = (...args): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      release = (): void =>
        void (outcome === 'fail'
          ? reject(new Error('quota'))
          : deleteInto(...args).then(resolve, reject));
    });
  const removed = c.ctx.songs.remove(id);
  await vi.advanceTimersByTimeAsync(0);
  bpm(c, value);
  expect(await c.autosave.flush()).toBe(true);
  expect(currentBpm()).toBe(value);
  release();
  const result = await removed;
  c.records.deleteInto = deleteInto;
  return result;
}

/** A reload over the same stores: a fresh console boots, accepting the Restore prompt. */
async function reload(): Promise<SessionConsole> {
  const fresh = openSessionConsole(false);
  const stores = { songs: c.store, library: c.records };
  const confirm = (): Promise<boolean> => Promise.resolve(true);
  await bootSongs(fresh.ctx, stores, {
    touched: touchWatch(fresh.ctx),
    confirm,
    delayMs: DELAY_MS,
  });
  return fresh;
}

describe('a failed delete of the open song after an edit landed in current', () => {
  it('keeps the edit in current until the retry stores it, so a reload restores it', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    expect(await deleteWithEditLanded(a, 142, 'fail')).toBe(false);
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(storedBpm(a)).not.toBe(142);
    expect(currentBpm()).toBe(142);
    // A reload before the retry restores the landed edit, not the older named record.
    const fresh = await reload();
    expect(fresh.ctx.model.doc.transport.bpm).toBe(142);
    expect(fresh.ctx.songs.state).toEqual({ kind: 'untitled' });
    // The retry succeeds: the song's record holds the edit, and current names it.
    expect(await c.autosave.flush()).toBe(true);
    expect(storedBpm(a)).toBe(142);
    expect(c.store.record).toMatchObject({ songId: a });
    expect(c.autosave.unsaved).toBe(false);
  });

  it('keeps the recovery copy while the owed retry fails', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    expect(await deleteWithEditLanded(a, 143, 'fail')).toBe(false);
    c.records.failing = true;
    expect(await c.autosave.flush()).toBe(false);
    expect(currentBpm()).toBe(143);
    expect((await reload()).ctx.model.doc.transport.bpm).toBe(143);
    c.records.failing = false;
    expect(await c.autosave.flush()).toBe(true);
    expect(c.store.record).toMatchObject({ songId: a });
  });

  it('points current at the song once a timed autosave stores the owed edit', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    expect(await deleteWithEditLanded(a, 144, 'fail')).toBe(false);
    bpm(c, 145);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(storedBpm(a)).toBe(145);
    expect(c.store.record).toMatchObject({ songId: a });
  });

  it('retries a failed repoint of current on the next stored write, so a reload reopens the song', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    expect(await deleteWithEditLanded(a, 147, 'fail')).toBe(false);
    // The owed write lands in the record, but the pointer write after it fails once.
    c.store.failing = true;
    await c.autosave.flush();
    c.store.failing = false;
    expect(storedBpm(a)).toBe(147);
    expect(currentBpm()).toBe(147);
    bpm(c, 148);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(storedBpm(a)).toBe(148);
    expect(c.store.record).toMatchObject({ songId: a });
    const fresh = await reload();
    expect(fresh.ctx.songs.state).toEqual({ kind: 'named', id: a });
    expect(fresh.ctx.model.doc.transport.bpm).toBe(148);
  });
});

describe('a stale delete of the open song after an edit landed in current', () => {
  it('keeps the edit in current for good, so a reload restores it', async () => {
    const a = (await c.ctx.songs.saveAs('A', []))!;
    const b = openSessionConsole(true, { records: c.records, store: c.store });
    expect(await b.ctx.songs.open(a)).toBe(true);
    bpm(b, 131);
    expect(await b.autosave.flush()).toBe(true);
    // B's open pointed current at A; A's edit then lands there while A's delete runs.
    expect(await deleteWithEditLanded(a, 146, 'run')).toBe(false);
    expect(c.toasts.at(-1)).toBe(`error: ${STALE_SONG_TEXT}`);
    expect(c.ctx.songs.stale).toBe(true);
    expect(storedBpm(a)).toBe(131);
    expect(await c.autosave.flush()).toBe(false);
    expect(currentBpm()).toBe(146);
    const fresh = await reload();
    expect(fresh.ctx.model.doc.transport.bpm).toBe(146);
    expect(c.records.docMap.has(a)).toBe(true);
  });
});
