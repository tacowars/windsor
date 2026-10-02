/**
 * The open song's autosave as the session starts it
 * (`2026-09-27-user-library-in-indexeddb`, decision 3): every change to the
 * model schedules a write. A restored song that renamed its generic parts on
 * load (windsor#103) saves that rename at once, but only when the restore
 * needed no repair. A restore the normaliser corrected, left dangling or
 * filled from the library is never written back by the rename: the stored
 * record is the user's only raw copy, and it stays until their first edit
 * replaces it (`2026-09-28-format-versions-refuse-never-destroy`). The rename
 * stays in memory and saves with that edit, as the repairs do.
 */
import type { AutosaveDeps } from './songAutosave';
import { SongAutosave } from './songAutosave';

/** What the autosave needs of the open song: its text, its changes and the open report. */
export interface AutosavedSong {
  readonly changed: boolean;
  readonly corrections: readonly string[];
  readonly dangling: readonly string[];
  readonly filled: readonly string[];
  onChange(listener: () => void): () => void;
  toJson(): string;
}

/** True when opening the song repaired it: a correction, a dangling entry or a library fill. */
export function openRepaired(song: AutosavedSong): boolean {
  return song.corrections.length > 0 || song.dangling.length > 0 || song.filled.length > 0;
}

/**
 * After a song was opened from a stored record (a restore, or a named song
 * reopened or opened from the library): write it back at once only when the
 * open changed it (the load-time rename) and repaired nothing. Otherwise the
 * stored record stays as it was until the first edit.
 */
export function saveOpenIfClean(song: AutosavedSong, autosave: SongAutosave): void {
  if (song.changed && !openRepaired(song)) autosave.schedule();
}

/** Every change to `song` schedules `autosave` from now on; `restored` says it was just opened from a stored record. */
export function followSong(song: AutosavedSong, autosave: SongAutosave, restored: boolean): void {
  song.onChange(() => autosave.schedule());
  if (restored) saveOpenIfClean(song, autosave);
}

/** Autosave `song` from now on; `restored` says it was just restored from the stored record. */
export function startAutosave(
  song: AutosavedSong,
  deps: Omit<AutosaveDeps, 'read'>,
  restored: boolean,
): SongAutosave {
  const autosave = new SongAutosave({ ...deps, read: () => song.toJson() });
  followSong(song, autosave, restored);
  return autosave;
}
