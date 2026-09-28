/**
 * The song autosave (`2026-09-27-user-library-in-indexeddb`, decision 3)
 * over an in-memory store and fake timers: one write after the quiet period,
 * a flush on demand, no write of unchanged text, and a failure reported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SongStore, StoredSong } from './songAutosave';
import { SongAutosave } from './songAutosave';

function memoryStore(): SongStore & { saves: StoredSong[] } {
  const saves: StoredSong[] = [];
  return {
    saves,
    load: () => Promise.resolve(saves.at(-1) ?? null),
    save: (song) => {
      saves.push(song);
      return Promise.resolve();
    },
  };
}

const NOW = new Date('2026-09-28T12:00:00.000Z');

describe('SongAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('writes once, after the quiet period following the last change', async () => {
    const store = memoryStore();
    let text = 'a';
    const autosave = new SongAutosave({
      store,
      read: () => text,
      report: () => {},
      delayMs: 1000,
      now: () => NOW,
    });
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(900);
    text = 'b';
    autosave.schedule();
    await vi.advanceTimersByTimeAsync(900);
    expect(store.saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(store.saves).toEqual([{ updated: NOW.toISOString(), document: 'b' }]);
    expect(autosave.pending).toBe(false);
  });

  it('flushes a waiting change at once, and skips text it already wrote', async () => {
    const store = memoryStore();
    const autosave = new SongAutosave({ store, read: () => 'same', report: () => {} });
    await autosave.flush();
    expect(store.saves).toHaveLength(0);
    autosave.schedule();
    await autosave.flush();
    autosave.schedule();
    await autosave.flush();
    expect(store.saves.map((song) => song.document)).toEqual(['same']);
  });

  it('reports a failed write, and tries again on the next change', async () => {
    const reports: string[] = [];
    let fail = true;
    const saves: string[] = [];
    const store: SongStore = {
      load: () => Promise.resolve(null),
      save: (song) => {
        if (fail) return Promise.reject(new Error('quota'));
        saves.push(song.document);
        return Promise.resolve();
      },
    };
    const autosave = new SongAutosave({ store, read: () => 'doc', report: (m) => reports.push(m) });
    autosave.schedule();
    await autosave.flush();
    expect(reports).toEqual(['autosave failed: quota']);
    fail = false;
    autosave.schedule();
    await autosave.flush();
    expect(saves).toEqual(['doc']);
  });
});
