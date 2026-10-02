/**
 * What the open-song session (`songSession.ts`, windsor#433) does with the
 * browser's storage: read a stored song for a switch, judging whether this
 * build can open it, point `current` at the open named song, and give the
 * autosave a named song's record as its target. It also words the problems
 * a reader is told about.
 */
import type { FormatRefusal } from '@windsor/engine';
import type { AutosaveTarget, SongAutosave, SongStore } from './songAutosave';
import { songFacts } from './songFacts';
import type { SongLibrary } from './songLibrary';
import { importRefusedText, songRefusal } from './songRestore';

/** The browser's storage, attached at boot; absent where there is no IndexedDB. */
export interface SessionStorage {
  library: SongLibrary;
  /** The session record, `songs/current`. */
  store: SongStore;
  autosave: SongAutosave;
}

/** Why a stored song did not open. */
export type OpenProblem =
  | { readonly problem: 'unavailable' | 'missing' | 'unsaved' }
  | { readonly problem: 'refused'; readonly name: string; readonly refusal: FormatRefusal }
  | { readonly problem: 'failed'; readonly message: string };

/** A stored song read for a switch: its text, raw document and name, or why it can't be opened. */
export type Readable =
  | { readonly ok: true; readonly text: string; readonly raw: unknown; readonly name: string }
  | ({ readonly ok: false } & OpenProblem);

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Stored song `id`'s text and document, or why this build can't open it. A
 * song in a format this build can't read is refused here, before anything
 * is replaced or written (`2026-09-28-format-versions-refuse-never-destroy`).
 */
export async function readStored(library: SongLibrary, id: string): Promise<Readable> {
  try {
    const text = await library.read(id);
    if (text === null) return { ok: false, problem: 'missing' };
    const raw: unknown = JSON.parse(text);
    const { name } = songFacts(text);
    const refusal = songRefusal(text);
    if (refusal) return { ok: false, problem: 'refused', name, refusal };
    return { ok: true, text, raw, name };
  } catch (error) {
    return { ok: false, problem: 'failed', message: errorText(error) };
  }
}

/** What the reader is told about `problem`, or null when there is nothing to add (it was told already). */
export function problemText(problem: OpenProblem): string | null {
  switch (problem.problem) {
    case 'refused':
      return importRefusedText(problem.name || 'the song', problem.refusal);
    case 'missing':
      return 'that song is no longer in your songs';
    case 'failed':
      return `couldn't open the song: ${problem.message}`;
    default:
      return null;
  }
}

/** The record named song `id` autosaves into; `written` hears each stored write (the "saved" time). */
export function namedTarget(library: SongLibrary, id: string, written: () => void): AutosaveTarget {
  return {
    save: async (text) => {
      await library.write(id, text);
      written();
    },
  };
}

/** Point `current` at named song `id`; resolves the failure's text, or null when it was written. */
export async function pointCurrentAt(
  store: SongStore,
  id: string,
  now: Date,
): Promise<string | null> {
  try {
    await store.save({ updated: now.toISOString(), songId: id });
    return null;
  } catch (error) {
    return `couldn't remember the open song: ${errorText(error)}`;
  }
}
