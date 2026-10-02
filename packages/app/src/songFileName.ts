/**
 * The export file name follows the song (windsor#434 decision 7, record
 * `2026-10-02-song-library` decision 10): the Document section's file name
 * field reads the open song's name as `<slug>.json`, or `untitled.json` for
 * a song with no name. A name the user types into the field stays until the
 * open song changes. Export audio reads the same field, so its names follow.
 */
import type { SongSessionState } from './songSession';

const UNTITLED_SLUG = 'untitled';
const JSON_EXTENSION = '.json';

/** A song's name as a file name: lowercase letters and digits joined by `-`, then `.json`. */
export function songFileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || UNTITLED_SLUG}${JSON_EXTENSION}`;
}

/**
 * Which song is open, as a key that changes whenever the open song does:
 * every replacement of the document (Open, New from, New song, Import),
 * and every change of record (Save as…, a delete of the open song). A
 * rename or a tag edit keeps it.
 */
export function openSongKey(state: SongSessionState, replacements: number): string {
  return `${replacements}:${state.kind === 'named' ? state.id : state.kind}`;
}

/** The field's value: the song's own file name, or the one typed for the song that is open. */
export class ExportNameMemory {
  private typed: { readonly song: string; readonly value: string } | null = null;

  /** What the field shows for song `song` named `name`; forgets a name typed for another song. */
  value(song: string, name: string): string {
    if (this.typed && this.typed.song !== song) this.typed = null;
    return this.typed?.value ?? songFileName(name);
  }

  /** The user typed `value` into the field while song `song` was open. */
  type(song: string, value: string): void {
    this.typed = { song, value };
  }
}
