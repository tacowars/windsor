/**
 * The named songs stored in this browser (windsor#433, record
 * `2026-10-02-song-library`): two records per song, the document and its
 * index. `SongLibrary` is the whole of what the open-song session needs from
 * storage; `songLibrary()` builds it over `SongRecords`, the two stores as
 * `userLibraryStore.ts` keeps them, which the tests fake in memory.
 *
 * - **The document is the song.** A doc record is the song's export text,
 *   exactly what Export writes, `meta` included.
 * - **The index is a cache.** Every field but `id`, `created`, `updated` and
 *   `revision` is derived from the text at each write (`songFacts`). There
 *   is no other metadata write path, so the index never names what the
 *   document doesn't.
 * - **One transaction.** A write puts both records together. Deleting the
 *   open song writes its text into `songs/current` in the same transaction
 *   as it deletes both records, so a committed copy always survives.
 * - **A stale tab is refused** (tacowars, 2026-10-02). Every write bumps the
 *   index's `revision`. A save names the revision it was based on, and its
 *   transaction refuses it (`StaleSongError`) when the stored song has moved
 *   on, because another tab saved it since. Nothing is overwritten silently.
 * - **Every write checks** (windsor#452). A save, a delete and an index
 *   repair each read the stored song inside their own transaction and
 *   refuse when it isn't what they were based on. A save to a song whose
 *   document is gone is refused, so a stale tab never brings a deleted song
 *   back; only `NEW_SONG`, the first write of a new id, creates one.
 * - **Refuse, never destroy** (`2026-09-28-format-versions-refuse-never-destroy`).
 *   `list()` marks a song this build cannot read from its index's `version`
 *   alone, without reading any document, and keeps it listed.
 */
import type { FormatRefusal } from '@windsor/engine';
import { upgradeSong } from '@windsor/engine';
import type { StoredSong } from './songAutosave';
import type { SongFacts } from './songFacts';
import { songFacts } from './songFacts';

/** One `songIndex` record: the derived facts plus the store's own id, times (ISO 8601) and revision. */
export interface SongIndexRecord extends SongFacts {
  readonly id: string;
  readonly created: string;
  readonly updated: string;
  /** How many writes the song has had; a repaired index starts again at 0. */
  readonly revision: number;
}

/** A row of the list: the index record, and why this build can't open it (null when it can). */
export interface SongListEntry extends SongIndexRecord {
  readonly refusal: FormatRefusal | null;
}

/** A save refused because the stored song moved on since its text was read: another tab saved it. */
export class StaleSongError extends Error {
  constructor(id: string) {
    super(`song ${id} was saved elsewhere since it was read`);
    this.name = 'StaleSongError';
  }
}

/**
 * The revision a song with a document is at: no index record, or one
 * written before revisions, is 0. A song with no document has none, and a
 * save based on any revision is refused (windsor#452).
 */
export const revisionOf = (index: SongIndexRecord | null): number =>
  index !== null && typeof index.revision === 'number' ? index.revision : 0;

/**
 * The judgement of a write or delete on what is stored for its song, read
 * inside its own transaction: the index record, and whether the document
 * exists. It throws to refuse, and then nothing is written.
 */
export type StoredCheck = (stored: SongIndexRecord | null, documented: boolean) => void;

/** The basis a write names for its first write of a new id: it creates the song, and is refused when the id is taken. */
export const NEW_SONG = 'new';

/** What a write is based on: the stored revision its text was edited from, or `NEW_SONG`. */
export type SongWriteBasis = number | typeof NEW_SONG;

/** The `songIndex` and `songDocs` stores, as records by song id. */
export interface SongRecords {
  indexes(): Promise<SongIndexRecord[]>;
  /** The ids that have a document, without reading the documents. */
  docIds(): Promise<string[]>;
  index(id: string): Promise<SongIndexRecord | null>;
  doc(id: string): Promise<string | null>;
  /**
   * Write song `id`'s index and document in one transaction. `next` is
   * handed the stored index record and whether the document exists, both
   * read inside that same transaction, and returns the record to write;
   * when it throws, nothing is written and the write rejects with its
   * error. Resolves the record written.
   */
  put(
    id: string,
    text: string,
    next: (stored: SongIndexRecord | null, documented: boolean) => SongIndexRecord,
  ): Promise<SongIndexRecord>;
  /** Write an index record alone, the repair of a missing one, when `check` passes in the same transaction. */
  putIndex(index: SongIndexRecord, check: StoredCheck): Promise<void>;
  /** Remove a song's index and document in one transaction, when `check` passes in it. */
  delete(id: string, check: StoredCheck): Promise<void>;
  /**
   * Remove a song's two records and write `session` as `songs/current`, in
   * one transaction across the three stores, when `check` passes in it.
   */
  deleteInto(id: string, session: StoredSong, check: StoredCheck): Promise<void>;
}

/** A stored song's text and the revision it was read at. */
export interface LoadedSong {
  readonly text: string;
  readonly revision: number;
}

export interface SongLibrary {
  /** Every stored song's index record, with its refusal; never reads a document it has an index for. */
  list(): Promise<SongListEntry[]>;
  /** A song's export text as stored, or null when there is none. */
  read(id: string): Promise<string | null>;
  /** A song's text and its revision, for a session that will save it; null when there is no document. */
  load(id: string): Promise<LoadedSong | null>;
  /**
   * Store `text` as song `id`, its index derived from the text; `created` is
   * kept and `revision` bumped. `basedOn` is the revision the text was
   * edited from: when the song's document is gone, or it is at any other
   * revision, the write rejects with `StaleSongError` and writes nothing.
   * `NEW_SONG` (the default) creates song `id`, and is refused the same way
   * when `id` already has a document.
   */
  write(id: string, text: string, basedOn?: SongWriteBasis): Promise<SongIndexRecord>;
  /**
   * Delete song `id`, based on revision `basedOn`: a song another tab saved
   * since is refused with `StaleSongError`, and nothing changes. A song
   * already gone deletes nothing more, and resolves.
   */
  remove(id: string, basedOn: number): Promise<void>;
  /**
   * Delete song `id` and make `session` the untitled `songs/current`, in one
   * transaction: the open song's delete, refused the way `remove` is.
   */
  removeOpen(id: string, session: StoredSong, basedOn: number): Promise<void>;
}

/** Why a song declaring `version` can't be opened by this build, or null when it can. */
export function versionRefusal(version: number | null): FormatRefusal | null {
  return version === null ? null : (upgradeSong({ version }).refused ?? null);
}

/** A delete's check: song `id` is gone, or still at `basedOn`. */
const unchangedSince =
  (id: string, basedOn: number): StoredCheck =>
  (stored, documented) => {
    if (documented && revisionOf(stored) !== basedOn) throw new StaleSongError(id);
  };

/** An index repair's check: song `id` has a document and still no index. */
const unindexed =
  (id: string): StoredCheck =>
  (stored, documented) => {
    if (stored !== null || !documented) throw new StaleSongError(id);
  };

const entry = (index: SongIndexRecord): SongListEntry => ({
  ...index,
  refusal: versionRefusal(index.version),
});

/**
 * The library over `records`. A document with no index record is indexed
 * again from its text (the repair is written back, best effort); an index
 * record with no document is left out of the list.
 */
export function songLibrary(records: SongRecords, now: () => Date = () => new Date()): SongLibrary {
  const derive = (id: string, text: string, stored: SongIndexRecord | null): SongIndexRecord => {
    const time = now().toISOString();
    const created = stored?.created ?? time;
    return { ...songFacts(text), id, created, updated: time, revision: revisionOf(stored) + 1 };
  };

  const reindex = async (id: string): Promise<SongIndexRecord | null> => {
    const text = await records.doc(id);
    if (text === null) return null;
    // Revision 0, the one a song with no index loads at, so a tab that opened it is not refused.
    const index = { ...derive(id, text, null), revision: 0 };
    // Only while the song still has no index: a save since has written a newer one.
    await records.putIndex(index, unindexed(id)).catch(() => undefined);
    return index;
  };

  return {
    async list() {
      const [indexes, docIds] = await Promise.all([records.indexes(), records.docIds()]);
      const documented = new Set(docIds);
      const kept = indexes.filter((index) => documented.has(index.id));
      const indexed = new Set(kept.map((index) => index.id));
      const missing = docIds.filter((id) => !indexed.has(id));
      const repaired = await Promise.all(missing.map(reindex));
      const found = repaired.filter((index): index is SongIndexRecord => index !== null);
      return [...kept, ...found].map(entry);
    },
    read: (id) => records.doc(id),
    async load(id) {
      // The revision first: a save landing between the two reads then makes
      // this tab's next save stale, never newer text under an older revision.
      const revision = revisionOf(await records.index(id));
      const text = await records.doc(id);
      return text === null ? null : { text, revision };
    },
    write: (id, text, basedOn = NEW_SONG) =>
      records.put(id, text, (stored, documented) => {
        if (basedOn === NEW_SONG) {
          if (documented) throw new StaleSongError(id);
          // A new song starts afresh, whatever index a lost document left behind.
          return derive(id, text, null);
        }
        if (!documented || revisionOf(stored) !== basedOn) throw new StaleSongError(id);
        return derive(id, text, stored);
      }),
    remove: (id, basedOn) => records.delete(id, unchangedSince(id, basedOn)),
    removeOpen: (id, session, basedOn) =>
      records.deleteInto(id, session, unchangedSince(id, basedOn)),
  };
}
