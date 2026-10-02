/**
 * The limits on a song's own name and tags (windsor#440; record
 * `2026-10-02-song-library`): what `songMetaNormalise.ts` cuts to. They size
 * a library list row and its tag chips, not anything the engine plays.
 */

export interface SongMetaLimits {
  /** Characters (code points) in a song's name. */
  readonly nameLength: number;
  /** Tags one song carries. */
  readonly tagCount: number;
  /** Characters (code points) in one tag. */
  readonly tagLength: number;
}

export const SONG_META_LIMITS: SongMetaLimits = {
  nameLength: 80,
  tagCount: 16,
  tagLength: 32,
};

/** The reserved tag that marks a song as a template in the library. */
export const TEMPLATE_TAG = 'template';
