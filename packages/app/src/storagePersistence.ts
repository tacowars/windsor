/**
 * Ask the browser to keep the user's library and autosaved song under storage
 * pressure (`navigator.storage.persist()`), once per page, on the first
 * write. A refusal is reported, never fatal: the data is still stored, only
 * evictable (`2026-09-27-user-library-in-indexeddb`).
 */

/** Resolves true when storage is (now) persistent. */
export type PersistRequest = () => Promise<boolean>;

/** The browser's request, or null where the Storage API has none. */
export function browserPersist(): PersistRequest | null {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function')
    return null;
  return () => navigator.storage.persist();
}

export const PERSIST_REFUSED =
  'this browser may clear your saved patches and song under storage pressure — export to keep a copy';

/**
 * A hook to call before every write: the first call makes the request and
 * reports a refusal or a failure; every later call shares that first one.
 */
export function persistOnce(
  persist: PersistRequest | null,
  report: (message: string) => void,
): () => Promise<void> {
  let asked: Promise<void> | null = null;
  return () => {
    asked ??= (async (): Promise<void> => {
      try {
        if (!persist || !(await persist())) report(PERSIST_REFUSED);
      } catch {
        report(PERSIST_REFUSED);
      }
    })();
    return asked;
  };
}
