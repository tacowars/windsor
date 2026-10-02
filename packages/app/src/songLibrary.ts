/**
 * The named songs stored in this browser (windsor#433, record
 * `2026-10-02-song-library`): two records per song, the document and its
 * index. `SongLibrary` is the whole of what the open-song session needs from
 * storage; `songLibrary()` builds it over `SongRecords`, the two stores as
 * `userLibraryStore.ts` keeps them, which the tests fake in memory.
 *
 * - **The document is the song.** A doc record is the song's export text,
 *   exactly what Export writes, `meta` included.
 * - **The index is a cache.** Every field but `id`, `created` and `updated` is
 *   derived from the text at each write (`songFacts`). There is no other
 *   metadata write path, so the index never names what the document doesn't.
 * - **One transaction.** A write puts both records together.
 * - **Refuse, never destroy** (`2026-09-28-format-versions-refuse-never-destroy`).
 *   `list()` marks a song this build cannot read from its index's `version`
 *   alone, without reading any document, and keeps it listed.
 */
import type { FormatRefusal } from '@windsor/engine';
import { upgradeSong } from '@windsor/engine';
import type { SongFacts } from './songFacts';
import { songFacts } from './songFacts';

/** One `songIndex` record: the derived facts plus the store's own id and times (ISO 8601). */
export interface SongIndexRecord extends SongFacts {
  readonly id: string;
  readonly created: string;
  readonly updated: string;
}

/** A row of the list: the index record, and why this build can't open it (null when it can). */
export interface SongListEntry extends SongIndexRecord {
  readonly refusal: FormatRefusal | null;
}

/** The `songIndex` and `songDocs` stores, as records by song id. */
export interface SongRecords {
  indexes(): Promise<SongIndexRecord[]>;
  /** The ids that have a document, without reading the documents. */
  docIds(): Promise<string[]>;
  index(id: string): Promise<SongIndexRecord | null>;
  doc(id: string): Promise<string | null>;
  /** Write a song's index and document in one transaction. */
  put(index: SongIndexRecord, text: string): Promise<void>;
  /** Write an index record alone: the repair of a missing one. */
  putIndex(index: SongIndexRecord): Promise<void>;
  /** Remove a song's index and document in one transaction. */
  delete(id: string): Promise<void>;
}

export interface SongLibrary {
  /** Every stored song's index record, with its refusal; never reads a document it has an index for. */
  list(): Promise<SongListEntry[]>;
  /** A song's export text as stored, or null when there is none. */
  read(id: string): Promise<string | null>;
  /** Store `text` as song `id`, its index derived from the text; `created` is kept. */
  write(id: string, text: string): Promise<SongIndexRecord>;
  remove(id: string): Promise<void>;
}

/** Why a song declaring `version` can't be opened by this build, or null when it can. */
export function versionRefusal(version: number | null): FormatRefusal | null {
  return version === null ? null : (upgradeSong({ version }).refused ?? null);
}

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
  const derive = (id: string, text: string, created: string | null): SongIndexRecord => {
    const time = now().toISOString();
    return { ...songFacts(text), id, created: created ?? time, updated: time };
  };

  const reindex = async (id: string): Promise<SongIndexRecord | null> => {
    const text = await records.doc(id);
    if (text === null) return null;
    const index = derive(id, text, null);
    await records.putIndex(index).catch(() => undefined);
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
    async write(id, text) {
      const existing = await records.index(id);
      const index = derive(id, text, existing?.created ?? null);
      await records.put(index, text);
      return index;
    },
    remove: (id) => records.delete(id),
  };
}
