/**
 * The revisions this tab has seen of the songs stored in this browser
 * (windsor#452): what a delete of a song that isn't open is based on. The
 * tab sees a song's revision in the list it shows, and in every write and
 * delete it makes itself; a song another tab saved since is then refused
 * (`songLibrary.ts`, "Every write checks").
 *
 * `seenRevisions` wraps the session's library, so every path that lists or
 * writes keeps the record without remembering to. A delete refused as stale
 * forgets the revision it was based on: the reader has been told, and a
 * delete asked for again is based on the song as it is then.
 */
import type { SongLibrary } from './songLibrary';
import { StaleSongError } from './songLibrary';

export interface SeenRevisions {
  /** The session's library, recording every revision it lists, writes or deletes. */
  readonly library: SongLibrary;
  /** The revision this tab last saw song `id` at, or undefined when it has seen none. */
  revision(id: string): number | undefined;
}

export function seenRevisions(library: SongLibrary): SeenRevisions {
  const seen = new Map<string, number>();
  return {
    revision: (id) => seen.get(id),
    library: {
      async list() {
        const entries = await library.list();
        for (const entry of entries) seen.set(entry.id, entry.revision);
        return entries;
      },
      read: (id) => library.read(id),
      load: (id) => library.load(id),
      async write(id, text, basedOn) {
        const index = await library.write(id, text, basedOn);
        seen.set(id, index.revision);
        return index;
      },
      async remove(id, basedOn) {
        try {
          await library.remove(id, basedOn);
        } catch (error) {
          if (error instanceof StaleSongError) seen.delete(id);
          throw error;
        }
        seen.delete(id);
      },
      async removeOpen(id, session, basedOn) {
        await library.removeOpen(id, session, basedOn);
        seen.delete(id);
      },
    },
  };
}
