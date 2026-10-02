/**
 * The user's own state at boot (`2026-09-27-user-library-in-indexeddb`):
 * open the `windsor` database, read the user's patches in beside the
 * built-ins, give the open-song session its storage (windsor#433), bring
 * back the last song — a named song reopens at once, an untitled one is
 * offered as before (`bootSong`) — and from then on autosave the open song
 * after each change and whenever the page is hidden. Where the browser has
 * no IndexedDB, the library is the built-ins alone, Save downloads, and the
 * session has no songs, as before. It also says the console's first word:
 * the new-song hint, or what became of the last session.
 */
import type { AppCtx } from './context';
import { bootLibrary, reportLibraryProblems } from './libraryActions';
import { BLOCKED_UPGRADE_WARNING, EVICTABLE_WARNING } from './libraryConstants';
import { openConfirm } from './metadataModal';
import { SongAutosave, isNamedSession } from './songAutosave';
import { songLibrary } from './songLibrary';
import { bootSong, touchWatch } from './songRestore';
import { browserPersist, persistOnce } from './storagePersistence';
import { openUserStores } from './userLibraryStore';
import { followSong } from './userSessionAutosave';

export async function bootUserState(ctx: AppCtx): Promise<void> {
  // Taken first: the open below can wait on an older tab for as long as it stays open.
  const touched = touchWatch(ctx);
  const ensurePersisted = persistOnce(browserPersist(), () =>
    ctx.notify(EVICTABLE_WARNING, 'warning'),
  );
  const stores = await openUserStores(
    () => void ensurePersisted(),
    () => ctx.notify(BLOCKED_UPGRADE_WARNING, 'warning'),
  );
  const stored = stores ? await stores.songs.load().catch(() => null) : null;
  const autosave = stores
    ? new SongAutosave({
        store: stores.songs,
        read: () => ctx.model.toJson(),
        report: (message) => ctx.notify(message, 'error'),
      })
    : null;
  if (stores && autosave) {
    ctx.songs.attach({ library: songLibrary(stores.library), store: stores.songs, autosave });
  }
  // The question and the library load run together; an open waits for the built-ins itself.
  const [, outcome] = await Promise.all([
    bootLibrary(stores?.patches ?? null).then(() => {
      reportLibraryProblems(ctx);
      ctx.render();
    }),
    bootSong(ctx, stored, openConfirm, { touched }),
  ]);
  // A boot that kept the stored song (the user had started) has said its word.
  if (outcome !== 'kept') {
    if (!stored)
      ctx.notify('new song — pick a sequencer for Part 1 in the Parts tab, or import a song');
    else if (outcome === 'new' && !isNamedSession(stored))
      ctx.notify('new song — your last session is kept until your first edit');
  }
  if (!autosave) return;
  // A clean open's load-time rename (windsor#103) saves now; a repaired one waits for an edit.
  followSong(ctx.model, autosave, outcome === 'opened');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void autosave.flush();
  });
  // A reload inside the quiet period, or before a write commits, is asked about first.
  window.addEventListener('beforeunload', (event) => {
    if (!autosave.unsaved) return;
    void autosave.flush();
    event.preventDefault();
    event.returnValue = '';
  });
}
