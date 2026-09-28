/**
 * The user's own state in IndexedDB (`2026-09-27-user-library-in-indexeddb`):
 * the `windsor` database, with the user's patches as a `PatchFolder` and the
 * autosaved song as a `SongStore`. Every value is the same text as its file,
 * so one loader reads a download, a folder file and a stored record alike.
 *
 * This is the one seam the Node tests cannot reach: the library model and the
 * autosave are tested over in-memory fakes of the two interfaces, and this
 * file is checked in the browser.
 */
import { USER_DB } from './libraryConstants';
import type { PatchFolder } from './libraryFolder';
import type { SongStore, StoredSong } from './songAutosave';

export interface UserStores {
  patches: PatchFolder;
  songs: SongStore;
}

const JSON_SUFFIX = '.json';
const idOf = (name: string): string =>
  name.endsWith(JSON_SUFFIX) ? name.slice(0, -JSON_SUFFIX.length) : name;

const refused = (request: IDBRequest | IDBOpenDBRequest): Error =>
  request.error ?? new Error('IndexedDB refused');

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(USER_DB.name, USER_DB.version);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(USER_DB.patches)) db.createObjectStore(USER_DB.patches);
      if (!db.objectStoreNames.contains(USER_DB.songs)) db.createObjectStore(USER_DB.songs);
    };
    request.onsuccess = (): void => resolve(request.result);
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

const isStoredSong = (value: unknown): value is StoredSong =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as StoredSong).updated === 'string' &&
  typeof (value as StoredSong).document === 'string';

function songStore(db: IDBDatabase, beforeWrite: () => void): SongStore {
  return {
    async load() {
      const value = await run<unknown>(db, USER_DB.songs, 'readonly', (s) =>
        s.get(USER_DB.currentSong),
      );
      return isStoredSong(value) ? value : null;
    },
    async save(song) {
      beforeWrite();
      await run(db, USER_DB.songs, 'readwrite', (s) => s.put(song, USER_DB.currentSong));
    },
  };
}

/**
 * Open the database and hand back its two stores, or null where the browser
 * has no usable IndexedDB (the console then falls back to downloads, and
 * nothing autosaves). `beforeWrite` runs before every write, unawaited: the
 * persistence request, which must never hold a save up.
 */
export async function openUserStores(beforeWrite: () => void): Promise<UserStores | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    return { patches: patchStore(db, beforeWrite), songs: songStore(db, beforeWrite) };
  } catch {
    return null;
  }
}
