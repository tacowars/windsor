/**
 * Restoring the last session (`2026-09-27-user-library-in-indexeddb`,
 * decision 1): the console boots on a new song as it always has, and when an
 * autosaved song exists it asks first, showing when it was saved. Restoring
 * opens the record the way Import opens a file, after the built-ins have
 * arrived; declining keeps the record until the first edit replaces it, so a
 * mis-click is undone by reloading.
 */
import { loadBuiltIns } from './builtInLibrary';
import type { AppCtx } from './context';
import type { ConfirmRequest } from './metadataModal';
import type { StoredSong } from './songAutosave';

/** When the record was written, in the reader's locale; the raw text if it is not a date. */
export function savedWhen(stored: StoredSong): string {
  const date = new Date(stored.updated);
  return Number.isNaN(date.getTime())
    ? stored.updated
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The question the console asks at boot. */
export function restoreRequest(stored: StoredSong): ConfirmRequest {
  return {
    title: 'Restore your last session?',
    body:
      `Your last song was saved in this browser on ${savedWhen(stored)}. ` +
      'Restore it, or start on a new song? The saved song is kept until your first edit replaces it.',
    ok: 'Restore',
  };
}

/** Open the stored song the way Import opens a file: after the built-ins, for an older song's library fill (#562). */
export async function restoreSong(ctx: AppCtx, stored: StoredSong): Promise<void> {
  await loadBuiltIns();
  ctx.parts.selected = 0;
  ctx.importDoc(JSON.parse(stored.document) as unknown);
  ctx.status(`restored the song saved ${savedWhen(stored)}`);
}

/** Ask, and restore on yes; a record that fails to open is reported and left in place. */
export async function offerRestore(
  ctx: AppCtx,
  stored: StoredSong | null,
  confirm: (request: ConfirmRequest) => Promise<boolean>,
): Promise<boolean> {
  if (!stored || !(await confirm(restoreRequest(stored)))) return false;
  try {
    await restoreSong(ctx, stored);
    return true;
  } catch (error) {
    ctx.status(`restore failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
