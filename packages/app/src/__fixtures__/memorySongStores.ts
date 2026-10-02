/**
 * In-memory stand-ins for the song stores IndexedDB keeps (windsor#433):
 * the session record `current` and the library's two stores. Each counts
 * what was read and written, and can be told to reject every write, as a
 * full disk would. The library's records share a session store, so the
 * open song's delete writes `current` and deletes its records together,
 * or not at all, as the one IndexedDB transaction does. Every write and
 * delete hands its check the song as stored, and a refusal changes nothing.
 */
import type { SessionRecord, SongStore } from '../songAutosave';
import type { SongIndexRecord, SongRecords, StoredCheck } from '../songLibrary';

export interface MemorySessionStore extends SongStore {
  record: SessionRecord | null;
  /** Every record written, in order. */
  readonly saves: SessionRecord[];
  failing: boolean;
}

export interface MemorySongRecords extends SongRecords {
  readonly indexMap: Map<string, SongIndexRecord>;
  readonly docMap: Map<string, string>;
  /** Every id whose document was read, in order. */
  readonly docReads: string[];
  /** Writes that reached the stores (puts, index repairs, deletes). */
  writes: number;
  /** While true, every write rejects with "quota" and changes nothing. */
  failing: boolean;
}

const quota = (): Promise<never> => Promise.reject(new Error('quota'));

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

/** Why a write or delete of song `id` changes nothing (the stores failing, `check` refusing), or null. */
function refusal(
  records: MemorySongRecords,
  id: string,
  check: StoredCheck,
): Promise<never> | null {
  if (records.failing) return quota();
  try {
    check(records.indexMap.get(id) ?? null, records.docMap.has(id));
    return null;
  } catch (error) {
    return Promise.reject(asError(error));
  }
}

export function memorySessionStore(record: SessionRecord | null = null): MemorySessionStore {
  const store: MemorySessionStore = {
    record,
    saves: [],
    failing: false,
    load: () => Promise.resolve(store.record),
    save: (next) => {
      if (store.failing) return quota();
      store.record = next;
      store.saves.push(next);
      return Promise.resolve();
    },
  };
  return store;
}

/** The library's two stores, beside `session` (a fresh one when none is given). */
export function memorySongRecords(
  session: MemorySessionStore = memorySessionStore(),
): MemorySongRecords {
  const records: MemorySongRecords = {
    indexMap: new Map(),
    docMap: new Map(),
    docReads: [],
    writes: 0,
    failing: false,
    indexes: () => Promise.resolve([...records.indexMap.values()]),
    docIds: () => Promise.resolve([...records.docMap.keys()]),
    index: (id) => Promise.resolve(records.indexMap.get(id) ?? null),
    doc: (id) => {
      records.docReads.push(id);
      return Promise.resolve(records.docMap.get(id) ?? null);
    },
    put: (id, text, next) => {
      if (records.failing) return quota();
      let index: SongIndexRecord;
      try {
        index = next(records.indexMap.get(id) ?? null, records.docMap.has(id));
      } catch (error) {
        return Promise.reject(asError(error));
      }
      records.writes++;
      records.indexMap.set(id, index);
      records.docMap.set(id, text);
      return Promise.resolve(index);
    },
    putIndex: (index, check) => {
      const refused = refusal(records, index.id, check);
      if (refused) return refused;
      records.writes++;
      records.indexMap.set(index.id, index);
      return Promise.resolve();
    },
    delete: (id, check) => {
      const refused = refusal(records, id, check);
      if (refused) return refused;
      records.writes++;
      records.indexMap.delete(id);
      records.docMap.delete(id);
      return Promise.resolve();
    },
    deleteInto: (id, current, check) => {
      if (session.failing) return quota();
      const refused = refusal(records, id, check);
      if (refused) return refused;
      records.writes++;
      session.record = current;
      session.saves.push(current);
      records.indexMap.delete(id);
      records.docMap.delete(id);
      return Promise.resolve();
    },
  };
  return records;
}
