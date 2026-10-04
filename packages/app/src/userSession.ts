/**
 * The user's own state at boot (`2026-09-27-user-library-in-indexeddb`):
 * open the `windsor` database, read the user's patches in beside the
 * built-ins, and hand the song half (`userSessionSongs.ts`, windsor#433) its
 * stores: it attaches the open-song session, brings back the last song — a
 * named song reopens at once, an untitled one is offered as before — and
 * autosaves the open song after each change. This file adds the page's
 * hooks: a flush whenever the page is hidden, and a "Leave site?" question
 * while a change is unsaved. Where the browser has no IndexedDB, the library
 * is the built-ins alone, Save downloads, and the session has no songs, as
 * before. It also says the console's first word: the new-song hint, or what
 * became of the last session. The restore question waits for the audio
 * gate's first pass (windsor#581), so it never opens over the gate.
 */
import type { AppCtx } from './context';
import { bootLibrary, reportLibraryProblems } from './libraryActions';
import { BLOCKED_UPGRADE_WARNING, EVICTABLE_WARNING } from './libraryConstants';
import { openConfirm, type ConfirmRequest } from './metadataModal';
import type { SongAutosave } from './songAutosave';
import { isNamedSession } from './songAutosave';
import { touchWatch } from './songRestore';
import { browserPersist, persistOnce } from './storagePersistence';
import { openUserStores } from './userLibraryStore';
import { bootSongs } from './userSessionSongs';

/**
 * `gatePassed` is the audio gate's first pass; only a question at boot waits
 * on it. The library load, the toasts and the autosave hooks do not.
 */
export async function bootUserState(ctx: AppCtx, gatePassed: Promise<void>): Promise<void> {
  // Taken first: the open below can wait on an older tab for as long as it stays open.
  const touched = touchWatch(ctx);
  const ensurePersisted = persistOnce(browserPersist(), () =>
    ctx.notify(EVICTABLE_WARNING, 'warning'),
  );
  const stores = await openUserStores(
    () => void ensurePersisted(),
    () => ctx.notify(BLOCKED_UPGRADE_WARNING, 'warning'),
  );
  const confirm = async (request: ConfirmRequest): Promise<boolean> => {
    await gatePassed;
    return openConfirm(request);
  };
  // The question and the library load run together; an open waits for the built-ins itself.
  const [, { stored, outcome, autosave }] = await Promise.all([
    bootLibrary(stores?.patches ?? null).then(() => {
      reportLibraryProblems(ctx);
      ctx.render();
    }),
    bootSongs(ctx, stores, { touched, confirm }),
  ]);
  // A boot that kept the stored song (the user had started) has said its word.
  if (outcome !== 'kept') {
    if (!stored)
      ctx.notify('new song — pick a sequencer for Part 1 in the Parts tab, or import a song');
    else if (outcome === 'new' && !isNamedSession(stored))
      ctx.notify('new song — your last session is kept until your first edit');
  }
  if (autosave) hookPage(autosave);
}

/** Flush when the page is hidden; ask before leaving while a change is unsaved, and start its flush. */
function hookPage(autosave: SongAutosave): void {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void autosave.flush();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!autosave.unsaved) return;
    void autosave.flush();
    event.preventDefault();
    event.returnValue = '';
  });
}
