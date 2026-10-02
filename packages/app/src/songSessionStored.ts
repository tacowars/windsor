/**
 * The open-song session's operations on stored songs by id (windsor#433,
 * record `2026-10-02-song-library`): rename, retag, duplicate, export, and
 * delete a song that isn't open. None of them changes which song is open.
 *
 * - **The open song** is renamed or retagged through the model, as one
 *   document edit: it can be undone, and the autosave stores it.
 * - **Any other song** is read, given its new `meta`, and written back: a
 *   storage write, which can't be undone. A song this build can't read is
 *   refused and never rewritten
 *   (`2026-09-28-format-versions-refuse-never-destroy`); it can still be
 *   exported as it is.
 * - **Every write checks** (windsor#452). The rewrite of another song is
 *   based on the revision it read, and a delete on the one this tab last
 *   saw, so a save by another tab in between refuses it rather than being
 *   overwritten or deleted. A copy is a new song (`NEW_SONG`).
 */
import type { SongMeta } from '@windsor/engine';
import { songFacts } from './songFacts';
import { NEW_SONG, StaleSongError } from './songLibrary';
import { metaOf, withMeta } from './songMetaText';
import type { SessionHost } from './songSession';
import type { SessionStorage } from './songSessionStorage';
import { STALE_SONG_TEXT, errorText, problemText, readStored } from './songSessionStorage';

/** What these operations need of the session. */
export interface StoredSongs {
  readonly storage: SessionStorage;
  readonly host: SessionHost;
  isOpen(id: string): boolean;
  newId(): string;
  /** The revision this tab last saw song `id` at (`songSessionRevisions.ts`), or undefined. */
  seen(id: string): number | undefined;
  /** Tell the session's listeners a stored song changed. */
  emit(): void;
}

/** What the reader is told when another tab saved a song between this tab's read and its rewrite. */
export const CHANGED_SINCE_READ_TEXT = 'That song was just changed in another tab — try again.';

/** The name a duplicate takes. */
export const copyName = (name: string): string => `${name || 'Untitled'} copy`;

function fail(songs: StoredSongs, message: string | null): false {
  if (message !== null) songs.host.notify(message, 'error');
  return false;
}

/**
 * Give song `id` the `meta` that `edit` makes of its current one: on the
 * open song a document edit named `label`, on another a write of its text.
 */
export async function editMeta(
  songs: StoredSongs,
  id: string,
  edit: (meta: SongMeta) => SongMeta,
  label: string,
): Promise<boolean> {
  if (songs.isOpen(id)) {
    const result = songs.host.change({ meta: edit(metaOf(songs.host.model.doc)) }, label);
    songs.emit();
    return result.ok;
  }
  const song = await readStored(songs.storage.library, id);
  if (!song.ok) return fail(songs, problemText(song));
  const { name, tags } = songFacts(song.text);
  try {
    await songs.storage.library.write(id, withMeta(song.text, edit({ name, tags })), song.revision);
  } catch (error) {
    if (!(error instanceof StaleSongError)) return fail(songs, `save failed: ${errorText(error)}`);
    songs.emit();
    return fail(songs, CHANGED_SINCE_READ_TEXT);
  }
  songs.emit();
  return true;
}

/** A new stored song from song `id` (the open one as it stands), named `<name> copy`; resolves its id. */
export async function duplicateSong(songs: StoredSongs, id: string): Promise<string | null> {
  let text: string;
  if (songs.isOpen(id)) text = songs.host.model.toJson();
  else {
    const song = await readStored(songs.storage.library, id);
    if (!song.ok) {
      fail(songs, problemText(song));
      return null;
    }
    text = song.text;
  }
  const { name, tags } = songFacts(text);
  const copy = songs.newId();
  try {
    await songs.storage.library.write(
      copy,
      withMeta(text, { name: copyName(name), tags }),
      NEW_SONG,
    );
  } catch (error) {
    fail(songs, `duplicate failed: ${errorText(error)}`);
    return null;
  }
  songs.emit();
  return copy;
}

/**
 * Song `id`'s export text: the open song's as it stands, any other's exactly
 * as stored, a song this build can't read included. Null when there is none.
 */
export async function exportSong(songs: StoredSongs, id: string): Promise<string | null> {
  if (songs.isOpen(id)) return songs.host.model.toJson();
  return songs.storage.library.read(id);
}

/**
 * Delete song `id`, which isn't open, based on `revision`: by default the
 * one this tab last saw, or, for a song it has never seen, the one stored
 * now. A song another tab saved since is refused with the stale-tab words,
 * and nothing changes; the listeners hear of it either way, so the list
 * shows the song as it now is.
 */
export async function removeSong(
  songs: StoredSongs,
  id: string,
  revision = songs.seen(id),
): Promise<boolean> {
  const { library } = songs.storage;
  try {
    const basedOn = revision ?? (await library.load(id))?.revision;
    if (basedOn !== undefined) await library.remove(id, basedOn);
  } catch (error) {
    songs.emit();
    const stale = error instanceof StaleSongError;
    return fail(songs, stale ? STALE_SONG_TEXT : `delete failed: ${errorText(error)}`);
  }
  songs.emit();
  return true;
}
