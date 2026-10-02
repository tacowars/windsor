/**
 * What the open-song session (`songSession.ts`, windsor#433) does with the
 * browser's storage: read a stored song for a switch, judging whether this
 * build can open it, point `current` at the open named song, and give the
 * autosave a named song's record as its target. It also words the problems
 * a reader is told about.
 *
 * **A stale tab is refused** (tacowars, 2026-10-02): the named target saves
 * on the revision the open text was read at. When another tab has saved the
 * song since, the save is refused, the reader is told once, and from then
 * on the target writes nothing to that song; the edits stay open, and Save
 * as copy… keeps them.
 */
import type { FormatRefusal } from '@windsor/engine';
import type { AutosaveTarget, SongAutosave, SongStore } from './songAutosave';
import { ReportedRefusal } from './songAutosave';
import { songFacts } from './songFacts';
import type { SongLibrary } from './songLibrary';
import { StaleSongError } from './songLibrary';
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
  | { readonly problem: 'unavailable' | 'missing' | 'unsaved' | 'touched' }
  | { readonly problem: 'refused'; readonly name: string; readonly refusal: FormatRefusal }
  | { readonly problem: 'failed'; readonly message: string };

/** A stored song read for a switch: its text, raw document, name and revision. */
export interface StoredReadable {
  readonly ok: true;
  readonly text: string;
  readonly raw: unknown;
  readonly name: string;
  readonly revision: number;
}

/** A stored song read for a switch, or why it can't be opened. */
export type Readable = StoredReadable | ({ readonly ok: false } & OpenProblem);

/** What the refused tab is told when another tab saved its song since. */
export const STALE_SONG_TEXT =
  'This song was changed in another tab — Save as copy… to keep these edits.';

/** The open named song's record: its id, the revision its text is based on, and what became of it. */
export interface OpenRecord {
  readonly id: string;
  /** The stored revision the open text descends from; each save names it, and moves it on. */
  revision: number;
  /** Another tab saved the song since: this tab's saves to it are refused. */
  stale: boolean;
  /** Deleted in this session: a write captured before the delete writes nothing. */
  gone: boolean;
}

export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Stored song `id`'s text and document, or why this build can't open it. A
 * song in a format this build can't read is refused here, before anything
 * is replaced or written (`2026-09-28-format-versions-refuse-never-destroy`).
 */
export async function readStored(library: SongLibrary, id: string): Promise<Readable> {
  try {
    const song = await library.load(id);
    if (song === null) return { ok: false, problem: 'missing' };
    const { text, revision } = song;
    const raw: unknown = JSON.parse(text);
    const { name } = songFacts(text);
    const refusal = songRefusal(text);
    if (refusal) return { ok: false, problem: 'refused', name, refusal };
    return { ok: true, text, raw, name, revision };
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

/** What the named target tells the session: a write stored, or the song found saved by another tab. */
export interface TargetEvents {
  written(): void;
  stale(): void;
}

/**
 * The record the open named song autosaves into. Each save names the
 * revision `open` is at and moves it on; a save refused as stale marks
 * `open` stale and tells `events`, once, and every later save is refused
 * without touching the store. A deleted song's target writes nothing.
 */
export function namedTarget(
  library: SongLibrary,
  open: OpenRecord,
  events: TargetEvents,
): AutosaveTarget {
  return {
    save: async (text) => {
      if (open.gone) return;
      if (open.stale) throw new ReportedRefusal(STALE_SONG_TEXT);
      try {
        open.revision = (await library.write(open.id, text, open.revision)).revision;
      } catch (error) {
        if (!(error instanceof StaleSongError)) throw error;
        open.stale = true;
        events.stale();
        throw new ReportedRefusal(STALE_SONG_TEXT);
      }
      events.written();
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
