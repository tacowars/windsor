/**
 * The song half of the boot (windsor#433, record `2026-10-02-song-library`),
 * once the database has opened: give the open-song session its storage,
 * bring back the last song (`bootSong`), and autosave the open song from
 * then on. `userSession.ts` wires it to the browser; the tests drive it over
 * in-memory stores.
 *
 * - **Edits are followed from the moment the storage is attached,** so an
 *   edit made while the boot is still reading the last song is scheduled
 *   like any other. The boot's own open writes nothing (a named open and a
 *   restore are both quiet), and a clean open's load-time rename
 *   (windsor#103) is saved once it has opened (`saveOpenIfClean`).
 * - **A late boot never loses a touched song.** When the user edited,
 *   imported or started a song while the database was opening, the boot
 *   leaves it open (`kept`) and queues it for saving at once. It was never
 *   written, so until it is the autosave counts it unsaved, and leaving the
 *   page asks first.
 */
import type { AppCtx } from './context';
import type { ConfirmRequest } from './metadataModal';
import type { SessionRecord, SongStore } from './songAutosave';
import { SongAutosave } from './songAutosave';
import type { SongRecords } from './songLibrary';
import { songLibrary } from './songLibrary';
import type { BootOutcome } from './songRestore';
import { bootSong } from './songRestore';
import { followSong, saveOpenIfClean } from './userSessionAutosave';

/** The stores the song half needs: `songs/current` and the named songs. */
export interface BootStores {
  songs: SongStore;
  library: SongRecords;
}

export interface SongBootOptions {
  /** Whether the user touched the document since the console booted (`touchWatch`). */
  touched: () => boolean;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** The autosave's quiet period; the shipped one when left out. */
  delayMs?: number;
}

/** What the song half of the boot found and started. */
export interface SongBoot {
  /** The session record the last session left, or null. */
  stored: SessionRecord | null;
  outcome: BootOutcome;
  /** The open song's autosave; null without IndexedDB. */
  autosave: SongAutosave | null;
}

/** Bring back the last song and autosave from then on; without stores, only what `bootSong` does with none. */
export async function bootSongs(
  ctx: AppCtx,
  stores: BootStores | null,
  options: SongBootOptions,
): Promise<SongBoot> {
  const { touched, confirm } = options;
  if (!stores) {
    return {
      stored: null,
      outcome: await bootSong(ctx, null, confirm, { touched }),
      autosave: null,
    };
  }
  const stored = await stores.songs.load().catch(() => null);
  const autosave = new SongAutosave({
    store: stores.songs,
    read: () => ctx.model.toJson(),
    report: (message) => ctx.notify(message, 'error'),
    ...(options.delayMs === undefined ? {} : { delayMs: options.delayMs }),
  });
  ctx.songs.attach({ library: songLibrary(stores.library), store: stores.songs, autosave });
  followSong(ctx.model, autosave, false);
  const outcome = await bootSong(ctx, stored, confirm, { touched });
  if (outcome === 'opened') saveOpenIfClean(ctx.model, autosave);
  // Touched before anything followed it: owed now, so it is written and a reload asks until it is.
  if (outcome === 'kept') autosave.schedule();
  return { stored, outcome, autosave };
}
