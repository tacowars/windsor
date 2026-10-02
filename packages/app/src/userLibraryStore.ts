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
import type { SongIndexRecord, SongRecords, StoredCheck } from './songLibrary';

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

/**
 * One read-write transaction over `stores`, resolved when it commits. `body`
 * queues its requests, and may abort the transaction with a reason, which
 * the promise then rejects with.
 */
function transact(
  db: IDBDatabase,
  stores: readonly string[],
  body: (tx: IDBTransaction, abort: (reason: unknown) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([...stores], 'readwrite');
    let reason: unknown = null;
    const fail = (fallback: string) => (): void =>
      reject(reason ?? tx.error ?? new Error(fallback));
    tx.oncomplete = (): void => resolve();
    tx.onerror = fail('IndexedDB refused');
    tx.onabort = fail('IndexedDB transaction aborted');
    body(tx, (why) => {
      reason = why;
      tx.abort();
    });
  });
}

const SONG_STORES = [USER_DB.songIndex, USER_DB.songDocs] as const;

const asIndex = (value: unknown): SongIndexRecord | null =>
  typeof value === 'object' && value !== null && typeof (value as SongIndexRecord).id === 'string'
    ? (value as SongIndexRecord)
    : null;

/**
 * Read song `id`'s index record and whether its document exists, inside
 * `tx`, and hand them to `then`: what a write or delete judges, so no other
 * tab's write can fall between the judgement and the change. Requests in one
 * transaction run in order, so the index has been read when the count lands.
 */
function readSong(
  tx: IDBTransaction,
  id: string,
  then: (stored: SongIndexRecord | null, documented: boolean) => void,
): void {
  const index = tx.objectStore(USER_DB.songIndex).get(id);
  const docs = tx.objectStore(USER_DB.songDocs).count(id);
  docs.onsuccess = (): void => then(asIndex(index.result), docs.result > 0);
}

/**
 * One transaction over `stores` that runs `change` only when `check`
 * passes on song `id` as stored, read inside it; a refusal aborts it with
 * the check's error, and nothing is written.
 */
function checked(
  db: IDBDatabase,
  stores: readonly string[],
  id: string,
  check: StoredCheck,
  change: (tx: IDBTransaction) => void,
): Promise<void> {
  return transact(db, stores, (tx, abort) => {
    readSong(tx, id, (stored, documented) => {
      try {
        check(stored, documented);
      } catch (error) {
        abort(error);
        return;
      }
      change(tx);
    });
  });
}

/**
 * The named songs: `songIndex` and `songDocs`, both keyed by song id. The
 * open song's delete also writes `songs/current`, in the same transaction.
 * Every write and delete reads the song first, in its own transaction.
 */
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
    async put(id, text, next) {
      beforeWrite();
      const written: { index: SongIndexRecord | null } = { index: null };
      // `next` judges the song as stored, read in the write's own transaction.
      const check: StoredCheck = (stored, documented) => {
        written.index = next(stored, documented);
      };
      await checked(db, SONG_STORES, id, check, (tx) => {
        tx.objectStore(USER_DB.songIndex).put(written.index, id);
        tx.objectStore(USER_DB.songDocs).put(text, id);
      });
      if (!written.index) throw new Error('IndexedDB wrote no index record');
      return written.index;
    },
    putIndex(index, check) {
      return checked(db, SONG_STORES, index.id, check, (tx) => {
        tx.objectStore(USER_DB.songIndex).put(index, index.id);
      });
    },
    delete(id, check) {
      return checked(db, SONG_STORES, id, check, (tx) => {
        tx.objectStore(USER_DB.songIndex).delete(id);
        tx.objectStore(USER_DB.songDocs).delete(id);
      });
    },
    deleteInto(id, session, check) {
      beforeWrite();
      return checked(db, [USER_DB.songs, ...SONG_STORES], id, check, (tx) => {
        tx.objectStore(USER_DB.songs).put(session, USER_DB.currentSong);
        tx.objectStore(USER_DB.songIndex).delete(id);
        tx.objectStore(USER_DB.songDocs).delete(id);
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
