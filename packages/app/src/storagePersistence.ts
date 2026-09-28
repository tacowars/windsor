/**
 * Ask the browser to keep the user's library and autosaved song under storage
 * pressure (`navigator.storage.persist()`), once per page, on the first
 * write. A refusal is reported, never fatal: the data is still stored, only
 * evictable (`2026-09-27-user-library-in-indexeddb`). Chrome declines for
 * most sites a visitor has not bookmarked or used much, so the refusal is
 * the common case: one warning toast, beside the save's own.
 */

/** Resolves true when storage is (now) persistent. */
export type PersistRequest = () => Promise<boolean>;

/** The browser's request, or null where the Storage API has none. */
export function browserPersist(): PersistRequest | null {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.persist !== 'function')
    return null;
  return () => navigator.storage.persist();
}

/**
 * A hook to call before every write: the first call makes the request and
 * calls `refused` on a refusal or a failure; every later call shares that
 * first one.
 */
export function persistOnce(
  persist: PersistRequest | null,
  refused: () => void,
): () => Promise<void> {
  let asked: Promise<void> | null = null;
  return () => {
    asked ??= (async (): Promise<void> => {
      try {
        if (!persist || !(await persist())) refused();
      } catch {
        refused();
      }
    })();
    return asked;
  };
}
