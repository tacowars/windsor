/**
 * Asking before leaving (windsor#455): only the user's edits count. An
 * import's file-name amend is the open's own edit, so leaving right after it
 * asks nothing, while the amend still autosaves. Over in-memory stores and
 * fake timers.
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
const currentName = (): unknown => JSON.parse((c.store.record as StoredSong).document).meta?.name;

describe('leaveNeedsConfirm after an open', () => {
  it('is false after an import whose only change is its file name, and true after an edit', async () => {
    expect(
      await c.ctx.songs.importText(songText({ name: '', tags: [] }), 'Warehouse Jam.json'),
    ).toBe(true);
    expect(c.ctx.model.doc.meta?.name).toBe('Warehouse Jam');
    expect(c.ctx.model.changed).toBe(true);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(false);
    bpm(117);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(true);
  });

  it('is false the same way after ctx.importDoc of an unnamed file', async () => {
    expect(await c.ctx.importDoc(JSON.parse(songText()), 'loop.json')).toBe(true);
    expect(c.ctx.model.doc.meta?.name).toBe('loop');
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(false);
    bpm(118);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(true);
  });

  it('is false after a clean import of a named file, and true after an edit', async () => {
    expect(await c.ctx.songs.importText(songText({ name: 'Own', tags: [] }), 'x.json')).toBe(true);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(false);
    bpm(119);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(true);
  });

  it('is false after New song, and true after an edit', async () => {
    bpm(120);
    expect(await c.ctx.songs.newSong()).toBe(true);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(false);
    bpm(121);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(true);
  });

  it("still autosaves the import's file-name amend", async () => {
    await c.ctx.songs.importText(songText({ name: '', tags: [] }), 'Night Drive.json');
    expect(c.autosave.unsaved).toBe(true);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(currentName()).toBe('Night Drive');
    expect(c.autosave.unsaved).toBe(false);
    expect(c.ctx.songs.leaveNeedsConfirm()).toBe(false);
  });
});
