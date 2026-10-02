/**
 * The song half of the boot (windsor#433): a document the user touched
 * while the database was opening is kept and queued for saving at once, so
 * it is unsaved (a reload asks) until a flush writes it, with no second
 * edit needed; edits are followed from the moment the storage is attached;
 * and a clean boot reopens the named song. Over in-memory stores.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySessionStore, memorySongRecords } from './__fixtures__/memorySongStores';
import { DELAY_MS, openSessionConsole, songText } from './__fixtures__/songSessionConsole';
import { loadBuiltIns } from './builtInLibrary';
import type { StoredSong } from './songAutosave';
import { songLibrary } from './songLibrary';
import { touchWatch } from './songRestore';
import { bootSongs } from './userSessionSongs';

beforeAll(() => loadBuiltIns());
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-02T09:00:00.000Z') }));
afterEach(() => vi.useRealTimers());

const STAMP = '2026-10-02T08:00:00.000Z';
const never = (): Promise<boolean> => Promise.reject(new Error('asked a question'));

/** The browser's stores, holding named song `n` and a session record naming it. */
async function storesNamingN(): Promise<{
  songs: ReturnType<typeof memorySessionStore>;
  library: ReturnType<typeof memorySongRecords>;
}> {
  const songs = memorySessionStore({ updated: STAMP, songId: 'n' });
  const library = memorySongRecords(songs);
  await songLibrary(library).write('n', songText({ name: 'Night Drive', tags: [] }));
  return { songs, library };
}

describe('bootSongs', () => {
  it('keeps a song edited while the open was blocked, and stores it on a flush with no other edit', async () => {
    const c = openSessionConsole(false);
    const touched = touchWatch(c.ctx);
    // The database is still opening (an older tab blocks it): one edit.
    c.ctx.change({ transport: { bpm: 143 } });
    const stores = await storesNamingN();
    const booted = await bootSongs(c.ctx, stores, { touched, confirm: never, delayMs: DELAY_MS });
    expect(booted.outcome).toBe('kept');
    expect(c.ctx.songs.state).toEqual({ kind: 'untitled' });
    expect(booted.autosave!.unsaved).toBe(true);
    expect(await booted.autosave!.flush()).toBe(true);
    expect(JSON.parse((stores.songs.record as StoredSong).document).transport.bpm).toBe(143);
    expect(booted.autosave!.unsaved).toBe(false);
  });

  it('keeps an imported song the same way, and writes it once the quiet period ends', async () => {
    const c = openSessionConsole(false);
    const touched = touchWatch(c.ctx);
    expect(await c.ctx.importDoc(JSON.parse(songText({ name: 'Imported', tags: [] })))).toBe(true);
    const stores = await storesNamingN();
    const booted = await bootSongs(c.ctx, stores, { touched, confirm: never, delayMs: DELAY_MS });
    expect(booted.outcome).toBe('kept');
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(JSON.parse((stores.songs.record as StoredSong).document).meta.name).toBe('Imported');
  });

  it('reopens the named song when nothing was touched, writes nothing back, and follows the next edit', async () => {
    const c = openSessionConsole(false);
    const touched = touchWatch(c.ctx);
    const stores = await storesNamingN();
    const writes = stores.library.writes;
    const booted = await bootSongs(c.ctx, stores, { touched, confirm: never, delayMs: DELAY_MS });
    expect(booted.outcome).toBe('opened');
    expect(c.ctx.songs.state).toEqual({ kind: 'named', id: 'n' });
    await vi.advanceTimersByTimeAsync(DELAY_MS * 3);
    expect(stores.library.writes).toBe(writes);
    c.ctx.change({ transport: { bpm: 126 } });
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(JSON.parse(stores.library.docMap.get('n')!).transport.bpm).toBe(126);
  });

  it('without IndexedDB, starts no autosave', async () => {
    const c = openSessionConsole(false);
    const booted = await bootSongs(c.ctx, null, { touched: touchWatch(c.ctx), confirm: never });
    expect(booted).toEqual({ stored: null, outcome: 'new', autosave: null });
  });
});
