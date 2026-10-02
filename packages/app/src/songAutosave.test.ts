/**
 * The song autosave (`2026-09-27-user-library-in-indexeddb`, decision 3)
 * over an in-memory store and fake timers: one write after the quiet period,
 * a flush on demand, no write of unchanged text, and a failure reported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutosaveTarget, SessionRecord, SongStore } from './songAutosave';
import { ReportedRefusal, SongAutosave } from './songAutosave';

function memoryStore(): SongStore & { saves: SessionRecord[] } {
  const saves: SessionRecord[] = [];
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
    expect(store.saves).toEqual([expect.objectContaining({ document: 'same' })]);
  });

  it('reports a failed write, and tries again on the next change', async () => {
    const reports: string[] = [];
    let fail = true;
    const saves: string[] = [];
    const store: SongStore = {
      load: () => Promise.resolve(null),
      save: (song) => {
        if (fail) return Promise.reject(new Error('quota'));
        if ('document' in song) saves.push(song.document);
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

  describe('the song it writes to (windsor#433)', () => {
    /** A target that keeps what it was sent, and can be made to reject. */
    const target = (): AutosaveTarget & { texts: string[]; fail: boolean } => {
      const t = {
        texts: [] as string[],
        fail: false,
        save: (text: string) => {
          if (t.fail) return Promise.reject(new Error('quota'));
          t.texts.push(text);
          return Promise.resolve();
        },
      };
      return t;
    };

    it('tells its caller whether the flush stored the text', async () => {
      const a = target();
      const reports: string[] = [];
      const autosave = new SongAutosave({
        store: memoryStore(),
        read: () => 'a1',
        report: (m) => reports.push(m),
      });
      autosave.retarget(a);
      a.fail = true;
      autosave.schedule();
      expect(await autosave.flush()).toBe(false);
      expect(reports).toEqual(['autosave failed: quota']);
      // Still owed: the next flush tries again with no new change.
      a.fail = false;
      expect(await autosave.flush()).toBe(true);
      expect(a.texts).toEqual(['a1']);
    });

    it('reads the text and the target at the flush, so a switch right after never crosses them', async () => {
      const a = target();
      const b = target();
      let text = 'from A';
      const autosave = new SongAutosave({
        store: memoryStore(),
        read: () => text,
        report: () => {},
      });
      autosave.retarget(a);
      autosave.schedule();
      const flushed = autosave.flush();
      autosave.retarget(b, { owed: true });
      text = 'from B';
      const second = autosave.flush();
      expect(await flushed).toBe(true);
      expect(await second).toBe(true);
      expect(a.texts).toEqual(['from A']);
      expect(b.texts).toEqual(['from B']);
    });

    it('skips text the target already holds, and schedules nothing while quiet', async () => {
      const a = target();
      const autosave = new SongAutosave({
        store: memoryStore(),
        read: () => 'held',
        report: () => {},
        delayMs: 1000,
      });
      autosave.retarget(a, { written: 'held' });
      autosave.schedule();
      await autosave.flush();
      expect(a.texts).toEqual([]);
      autosave.quietly(() => autosave.schedule());
      expect(autosave.pending).toBe(false);
    });

    it('never drops a write still owed on a retarget, unless the target holds the open text', async () => {
      const a = target();
      const b = target();
      const reports: string[] = [];
      const autosave = new SongAutosave({
        store: memoryStore(),
        read: () => 'open',
        report: (m) => reports.push(m),
      });
      autosave.retarget(a);
      a.fail = true;
      autosave.schedule();
      expect(await autosave.flush()).toBe(false);
      autosave.retarget(b);
      expect(autosave.unsaved).toBe(true);
      expect(await autosave.flush()).toBe(true);
      expect(b.texts).toEqual(['open']);
      a.fail = false;
      autosave.retarget(a, { written: 'open' });
      expect(autosave.unsaved).toBe(false);
      // A refusal the target already reported stays owed and is not reported again.
      const refusing: AutosaveTarget = { save: () => Promise.reject(new ReportedRefusal('told')) };
      autosave.retarget(refusing, { owed: true });
      expect(await autosave.flush()).toBe(false);
      expect(autosave.unsaved).toBe(true);
      expect(reports).toEqual(['autosave failed: quota']);
    });

    it('drops a waiting change on cancel', async () => {
      const a = target();
      const autosave = new SongAutosave({
        store: memoryStore(),
        read: () => 'x',
        report: () => {},
      });
      autosave.retarget(a);
      autosave.schedule();
      expect(autosave.cancel()).toBe(true);
      expect(await autosave.flush()).toBe(true);
      expect(a.texts).toEqual([]);
    });
  });

  describe('unsaved, what beforeunload asks about', () => {
    it('holds while a change waits, while a write is out, and after a failure; clears once written', async () => {
      let release: () => void = () => {};
      let fail = false;
      const texts: string[] = [];
      const slow: AutosaveTarget = {
        save: (text) => {
          if (fail) return Promise.reject(new Error('quota'));
          return new Promise<void>((resolve) => {
            release = (): void => {
              texts.push(text);
              resolve();
            };
          });
        },
      };
      let text = 'a';
      const autosave = new SongAutosave({
        store: memoryStore(),
        read: () => text,
        report: () => {},
        delayMs: 1000,
      });
      autosave.retarget(slow);
      expect(autosave.unsaved).toBe(false);
      autosave.schedule();
      expect(autosave.unsaved).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect(autosave.pending).toBe(false);
      expect(autosave.unsaved).toBe(true);
      release();
      await autosave.settle();
      expect(texts).toEqual(['a']);
      expect(autosave.unsaved).toBe(false);
      fail = true;
      text = 'b';
      autosave.schedule();
      expect(await autosave.flush()).toBe(false);
      expect(autosave.unsaved).toBe(true);
    });
  });
});
