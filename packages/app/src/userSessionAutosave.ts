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

/** Autosave `song` from now on; `restored` says it was just restored from the stored record. */
export function startAutosave(
  song: AutosavedSong,
  deps: Omit<AutosaveDeps, 'read'>,
  restored: boolean,
): SongAutosave {
  const autosave = new SongAutosave({ ...deps, read: () => song.toJson() });
  song.onChange(() => autosave.schedule());
  if (restored && song.changed && !openRepaired(song)) autosave.schedule();
  return autosave;
}
