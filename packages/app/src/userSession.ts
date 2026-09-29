/**
 * The user's own state at boot (`2026-09-27-user-library-in-indexeddb`):
 * open the `windsor` database, read the user's patches in beside the
 * built-ins, offer to restore the autosaved song, and from then on autosave
 * the open song after each change and whenever the page is hidden. Where the
 * browser has no IndexedDB, the library is the built-ins alone and Save
 * downloads, as before. It also says the console's first word: the new-song
 * hint, or what became of the last session.
 */
import type { AppCtx } from './context';
import { bootLibrary, reportLibraryProblems } from './libraryActions';
import { EVICTABLE_WARNING } from './libraryConstants';
import { openConfirm } from './metadataModal';
import { SongAutosave } from './songAutosave';
import { offerRestore } from './songRestore';
import { browserPersist, persistOnce } from './storagePersistence';
import { openUserStores } from './userLibraryStore';

export async function bootUserState(ctx: AppCtx): Promise<void> {
  const ensurePersisted = persistOnce(browserPersist(), () =>
    ctx.notify(EVICTABLE_WARNING, 'warning'),
  );
  const stores = await openUserStores(() => void ensurePersisted());
  const stored = stores ? await stores.songs.load().catch(() => null) : null;
  // The question and the library load run together; a restore waits for the built-ins itself.
  const [, restored] = await Promise.all([
    bootLibrary(stores?.patches ?? null).then(() => {
      reportLibraryProblems(ctx);
      ctx.render();
    }),
    offerRestore(ctx, stored, openConfirm),
  ]);
  if (!stored)
    ctx.notify('new song — pick a sequencer for Part 1 in the Parts tab, or import a song');
  else if (!restored) ctx.notify('new song — your last session is kept until your first edit');
  if (!stores) return;
  const autosave = new SongAutosave({
    store: stores.songs,
    read: () => ctx.model.toJson(),
    report: (message) => ctx.notify(message, 'error'),
  });
  ctx.model.onChange(() => autosave.schedule());
  // A restore that renamed its generic parts on load (windsor#103) saves that now.
  if (restored && ctx.model.changed) autosave.schedule();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void autosave.flush();
  });
}
