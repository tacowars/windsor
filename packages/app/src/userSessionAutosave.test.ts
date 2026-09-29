/**
 * The session's autosave after a restore (windsor#103, fix round 2): the
 * load-time rename of a generic part saves at once when the restore was
 * clean, and never writes a repaired restore over the stored record, which
 * stays the user's raw copy until their first edit
 * (`2026-09-28-format-versions-refuse-never-destroy`).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clonePatch, partAt } from '@windsor/engine';
import { PRESETS } from '@windsor/engine/patch/presets';
import { DocumentModel } from './documentModel';
import { library, loadPageLibrary } from './libraryModel';
import { loadRenames } from './partAutoName';
import type { SongStore, StoredSong } from './songAutosave';
import { addPart, newSong } from './songParts';
import { startAutosave } from './userSessionAutosave';

const DELAY_MS = 1000;
const STORED_AT = '2026-09-28T12:00:00.000Z';

beforeAll(() => loadPageLibrary(library));

/** An in-memory store holding one record, as IndexedDB would at boot. */
function storeHolding(document: string): SongStore & { record: StoredSong } {
  const store = {
    record: { updated: STORED_AT, document },
    load: () => Promise.resolve(store.record),
    save: (song: StoredSong) => {
      store.record = song;
      return Promise.resolve();
    },
  };
  return store;
}

/** A song whose part on slot 1 is still `Part 2` and plays `saw-arp`; `lost` adds a part on an unknown preset. */
function storedSong(lost: boolean): string {
  const doc = new DocumentModel(addPart(new DocumentModel(newSong()).doc)!.doc).doc;
  const patches = { ...doc.patches, 'saw-arp': clonePatch(PRESETS['saw-arp']!) };
  const parts = doc.parts.map((part) => (part.slot === 1 ? { ...part, preset: 'saw-arp' } : part));
  const extra = lost ? [{ ...parts[0]!, slot: 2, preset: 'nope' }] : [];
  return JSON.stringify({ ...doc, parts: [...parts, ...extra], patches });
}

/** Restore the stored record the way `restoreSong` does, then start the session's autosave. */
function restore(store: SongStore & { record: StoredSong }): DocumentModel {
  const model = new DocumentModel(newSong());
  model.open(JSON.parse(store.record.document) as unknown, loadRenames);
  startAutosave(model, { store, report: () => {}, delayMs: DELAY_MS }, true);
  return model;
}

describe('the autosave after a restore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never writes a repaired restore back because of the rename', async () => {
    const raw = storedSong(true);
    const store = storeHolding(raw);
    const model = restore(store);
    expect(partAt(model.doc, 1)?.name).toBe('Saw Ar');
    expect(model.dangling).not.toEqual([]);
    await vi.advanceTimersByTimeAsync(DELAY_MS * 10);
    expect(store.record).toEqual({ updated: STORED_AT, document: raw });
    // The rename stays in memory and saves with the user's first edit.
    model.merge({ parts: { 0: { name: 'Bass' } } });
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(store.record.document).toBe(model.toJson());
    expect(partAt(JSON.parse(store.record.document), 1)?.name).toBe('Saw Ar');
  });

  it('saves the rename of a clean restore', async () => {
    const store = storeHolding(storedSong(false));
    const model = restore(store);
    expect(model.corrections).toEqual([]);
    expect(model.dangling).toEqual([]);
    expect(model.filled).toEqual([]);
    await vi.advanceTimersByTimeAsync(DELAY_MS);
    expect(store.record.document).toBe(model.toJson());
    expect(partAt(JSON.parse(store.record.document), 1)?.name).toBe('Saw Ar');
  });
});
