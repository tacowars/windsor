/**
 * The library folder (#563, epic #564 decision 5): a File System Access grant
 * on `packages/engine/src/patches/`, remembered in IndexedDB and
 * re-requested when the browser has dropped it. The folder is read through
 * the library's one loader, the same the built-ins and the user's IndexedDB
 * library load through, so the preset browser reflects a save without a
 * rebuild.
 *
 * `PatchFolder` is the whole of what the workflow needs from the handle; the
 * tests drive it with an in-memory fake and only `wrapDirectoryHandle` touches
 * the Chrome API.
 */
import type { FormatRefusal, LibraryEntry } from '@windsor/engine';
import { PatchFormatError, loadPatchFile } from '@windsor/engine';
import { HANDLE_DB } from './libraryConstants';
import type { LibraryEntries } from './patchMetadata';

export interface PatchFolder {
  name: string;
  /** The folder's file names. */
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/**
 * A stored patch in a format this build cannot read
 * (`2026-09-28-format-versions-refuse-never-destroy`): kept, listed as old,
 * never playable, with its text exactly as stored for Export.
 */
export interface OldFormatPatch {
  id: string;
  /** The file's own `name` when it has one, else the id. */
  name: string;
  text: string;
  refusal: FormatRefusal;
}

export interface FolderLibrary {
  entries: LibraryEntries;
  /** Files that did not load, each with the loader's message; shown, never fatal. */
  problems: string[];
  /** Files in a format this build cannot read, kept apart from `problems`. */
  oldFormat: OldFormatPatch[];
}

/** The display name an old file gives itself, without trusting its shape. */
function oldName(raw: unknown, id: string): string {
  const name = (raw as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name.trim() ? name : id;
}

const JSON_SUFFIX = '.json';

/** Every `<id>.json` in the folder through the library loader; a bad file is reported, an old one kept, neither fatal. */
export async function readFolderLibrary(folder: PatchFolder): Promise<FolderLibrary> {
  const entries: Record<string, LibraryEntry> = {};
  const problems: string[] = [];
  const oldFormat: OldFormatPatch[] = [];
  const names = (await folder.list()).filter((name) => name.endsWith(JSON_SUFFIX)).sort();
  for (const name of names) {
    const id = name.slice(0, -JSON_SUFFIX.length);
    let text = '';
    let raw: unknown;
    try {
      text = await folder.read(name);
      raw = JSON.parse(text);
      entries[id] = loadPatchFile(id, raw);
    } catch (error) {
      if (error instanceof PatchFormatError) {
        oldFormat.push({ id, name: oldName(raw, id), text, refusal: error.refusal });
      } else problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { entries, problems, oldFormat };
}

// --- The Chrome side: the handle, its permission and its IndexedDB home ---

type PermissionState = 'granted' | 'denied' | 'prompt';

/** The subset of Chrome's `FileSystemDirectoryHandle` this module uses. */
export interface ChromeDirectoryHandle {
  name: string;
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    getFile(): Promise<{ text(): Promise<string> }>;
    createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  }>;
  removeEntry(name: string): Promise<void>;
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
    }) => Promise<ChromeDirectoryHandle>;
  }
}

export const folderApiAvailable = (): boolean =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

export function wrapDirectoryHandle(handle: ChromeDirectoryHandle): PatchFolder {
  return {
    name: handle.name,
    async list() {
      const names: string[] = [];
      for await (const entry of handle.values()) if (entry.kind === 'file') names.push(entry.name);
      return names;
    },
    async read(name) {
      const file = await (await handle.getFileHandle(name)).getFile();
      return file.text();
    },
    async write(name, text) {
      const writable = await (await handle.getFileHandle(name, { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    },
    remove: (name) => handle.removeEntry(name),
  };
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB.name, 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore(HANDLE_DB.store);
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB refused'));
  });
}

/** One request against the handle store; the connection is closed however the request ends (#620). */
async function handleStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openHandleDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(HANDLE_DB.store, mode).objectStore(HANDLE_DB.store));
      request.onsuccess = (): void => resolve(request.result);
      request.onerror = (): void => reject(request.error ?? new Error('IndexedDB refused'));
    });
  } finally {
    db.close();
  }
}

export const rememberHandle = (handle: ChromeDirectoryHandle): Promise<unknown> =>
  handleStore('readwrite', (store) => store.put(handle, HANDLE_DB.key));

export const forgetHandle = (): Promise<unknown> =>
  handleStore('readwrite', (store) => store.delete(HANDLE_DB.key));

/** The remembered handle, or null when none was stored or IndexedDB is unavailable. */
export async function recallHandle(): Promise<ChromeDirectoryHandle | null> {
  try {
    const stored = await handleStore<unknown>('readonly', (store) => store.get(HANDLE_DB.key));
    return (stored as ChromeDirectoryHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

/** The grant's state without prompting: usable on load only when 'granted'. */
export const queryGrant = (handle: ChromeDirectoryHandle): Promise<PermissionState> =>
  handle.queryPermission({ mode: 'readwrite' });

/** Re-request a dropped grant; needs a user gesture. */
export const requestGrant = (handle: ChromeDirectoryHandle): Promise<PermissionState> =>
  handle.requestPermission({ mode: 'readwrite' });

/** The picker itself; needs a user gesture. Null when the user cancelled. */
export async function pickDirectory(): Promise<ChromeDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite', id: HANDLE_DB.key });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}
