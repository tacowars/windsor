/**
 * The user's own state in IndexedDB (`2026-09-27-user-library-in-indexeddb`):
 * the `windsor` database, with the user's patches as a `PatchFolder`, the
 * session record as a `SongStore`, and (windsor#433, record
 * `2026-10-02-song-library`) the named songs as `SongRecords`. Every song
 * and patch value is the same text as its file, so one loader reads a
 * download, a folder file and a stored record alike.
 *
 * This is the one seam the Node tests cannot reach: the library model, the
 * song library and the autosave are tested over in-memory fakes of the three
 * interfaces, and this file is checked in the browser.
 */
import { USER_DB } from './libraryConstants';
import type { PatchFolder } from './libraryFolder';
import type { SessionRecord, SongStore } from './songAutosave';
import type { SongIndexRecord, SongRecords } from './songLibrary';

export interface UserStores {
  patches: PatchFolder;
  songs: SongStore;
  library: SongRecords;
}

const JSON_SUFFIX = '.json';
const idOf = (name: string): string =>
  name.endsWith(JSON_SUFFIX) ? name.slice(0, -JSON_SUFFIX.length) : name;

const refused = (request: IDBRequest | IDBOpenDBRequest): Error =>
  request.error ?? new Error('IndexedDB refused');

/**
 * Open the database. An older tab still holding an earlier version blocks
 * the upgrade (a build before version 2 never lets go): `onBlocked` hears
 * it, once, and the open keeps waiting until that tab closes.
 */
function openDb(onBlocked: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(USER_DB.name, USER_DB.version);
    let told = false;
    request.onblocked = (): void => {
      if (told) return;
      told = true;
      onBlocked();
    };
    request.onupgradeneeded = (): void => {
      const db = request.result;
      // Version 2 is additive: the two song stores join, and nothing else changes.
      for (const store of [USER_DB.patches, USER_DB.songs, USER_DB.songIndex, USER_DB.songDocs]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = (): void => {
      const db = request.result;
      // Every open lets go when another tab's newer build upgrades, so this build never blocks one.
      db.onversionchange = (): void => db.close();
      resolve(db);
    };
    request.onerror = (): void => reject(refused(request));
  });
}

/** One request against one store, resolved when its transaction commits. */
function run<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = op(tx.objectStore(store));
    tx.oncomplete = (): void => resolve(request.result);
    tx.onerror = (): void => reject(refused(request));
    tx.onabort = (): void => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function patchStore(db: IDBDatabase, beforeWrite: () => void): PatchFolder {
  return {
    name: 'your library',
    async list() {
      const keys = await run(db, USER_DB.patches, 'readonly', (s) => s.getAllKeys());
      return keys.map((key) => `${String(key)}${JSON_SUFFIX}`);
    },
    async read(name) {
      const text = await run<unknown>(db, USER_DB.patches, 'readonly', (s) => s.get(idOf(name)));
      if (typeof text !== 'string') throw new Error(`${name}: not in your library`);
      return text;
    },
    async write(name, text) {
      beforeWrite();
      await run(db, USER_DB.patches, 'readwrite', (s) => s.put(text, idOf(name)));
    },
    async remove(name) {
      await run(db, USER_DB.patches, 'readwrite', (s) => s.delete(idOf(name)));
    },
  };
}

const isSessionRecord = (value: unknown): value is SessionRecord => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<Record<string, unknown>>;
  return (
    typeof record['updated'] === 'string' &&
    (typeof record['document'] === 'string' || typeof record['songId'] === 'string')
  );
};

function songStore(db: IDBDatabase, beforeWrite: () => void): SongStore {
  return {
    async load() {
      const value = await run<unknown>(db, USER_DB.songs, 'readonly', (s) =>
        s.get(USER_DB.currentSong),
      );
      return isSessionRecord(value) ? value : null;
    },
    async save(record) {
      beforeWrite();
      await run(db, USER_DB.songs, 'readwrite', (s) => s.put(record, USER_DB.currentSong));
    },
  };
}

/** Writes to both song stores in one transaction, resolved when it commits. */
function both(
  db: IDBDatabase,
  write: (index: IDBObjectStore, docs: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([USER_DB.songIndex, USER_DB.songDocs], 'readwrite');
    write(tx.objectStore(USER_DB.songIndex), tx.objectStore(USER_DB.songDocs));
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error('IndexedDB refused'));
    tx.onabort = (): void => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

const asIndex = (value: unknown): SongIndexRecord | null =>
  typeof value === 'object' && value !== null && typeof (value as SongIndexRecord).id === 'string'
    ? (value as SongIndexRecord)
    : null;

/** The named songs: `songIndex` and `songDocs`, both keyed by song id. */
function songRecords(db: IDBDatabase, beforeWrite: () => void): SongRecords {
  return {
    async indexes() {
      const values = await run<unknown[]>(db, USER_DB.songIndex, 'readonly', (s) => s.getAll());
      return values.map(asIndex).filter((index): index is SongIndexRecord => index !== null);
    },
    async docIds() {
      const keys = await run(db, USER_DB.songDocs, 'readonly', (s) => s.getAllKeys());
      return keys.map(String);
    },
    async index(id) {
      return asIndex(await run<unknown>(db, USER_DB.songIndex, 'readonly', (s) => s.get(id)));
    },
    async doc(id) {
      const text = await run<unknown>(db, USER_DB.songDocs, 'readonly', (s) => s.get(id));
      return typeof text === 'string' ? text : null;
    },
    put(index, text) {
      beforeWrite();
      return both(db, (indexStore, docs) => {
        indexStore.put(index, index.id);
        docs.put(text, index.id);
      });
    },
    async putIndex(index) {
      await run(db, USER_DB.songIndex, 'readwrite', (s) => s.put(index, index.id));
    },
    delete(id) {
      return both(db, (indexStore, docs) => {
        indexStore.delete(id);
        docs.delete(id);
      });
    },
  };
}

/**
 * Open the database and hand back its stores, or null where the browser
 * has no usable IndexedDB (the console then falls back to downloads, and
 * nothing autosaves). `beforeWrite` runs before every write, unawaited: the
 * persistence request, which must never hold a save up. `onBlocked` hears,
 * once, that an older tab is holding the upgrade up; the open waits for it.
 */
export async function openUserStores(
  beforeWrite: () => void,
  onBlocked: () => void = () => {},
): Promise<UserStores | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb(onBlocked);
    return {
      patches: patchStore(db, beforeWrite),
      songs: songStore(db, beforeWrite),
      library: songRecords(db, beforeWrite),
    };
  } catch {
    return null;
  }
}
