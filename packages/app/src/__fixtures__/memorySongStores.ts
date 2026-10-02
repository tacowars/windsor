/**
 * In-memory stand-ins for the song stores IndexedDB keeps (windsor#433):
 * the session record `current` and the library's two stores. Each counts
 * what was read and written, and can be told to reject every write, as a
 * full disk would.
 */
import type { SessionRecord, SongStore } from '../songAutosave';
import type { SongIndexRecord, SongRecords } from '../songLibrary';

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

export function memorySongRecords(): MemorySongRecords {
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
    put: (index, text) => {
      if (records.failing) return quota();
      records.writes++;
      records.indexMap.set(index.id, index);
      records.docMap.set(index.id, text);
      return Promise.resolve();
    },
    putIndex: (index) => {
      if (records.failing) return quota();
      records.writes++;
      records.indexMap.set(index.id, index);
      return Promise.resolve();
    },
    delete: (id) => {
      if (records.failing) return quota();
      records.writes++;
      records.indexMap.delete(id);
      records.docMap.delete(id);
      return Promise.resolve();
    },
  };
  return records;
}

export interface MemorySessionStore extends SongStore {
  record: SessionRecord | null;
  /** Every record written, in order. */
  readonly saves: SessionRecord[];
  failing: boolean;
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
