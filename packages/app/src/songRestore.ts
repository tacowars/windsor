/**
 * Restoring the last session (`2026-09-27-user-library-in-indexeddb`,
 * decision 1): the console boots on a new song as it always has, and when an
 * autosaved song exists it asks first, showing when it was saved. Restoring
 * opens the record the way Import opens a file, after the built-ins have
 * arrived; declining keeps the record until the first edit replaces it, so a
 * mis-click is undone by reloading.
 *
 * A record in a song format this build cannot read is never opened and never
 * deleted (`2026-09-28-format-versions-refuse-never-destroy`): the question
 * says which format it is and offers the stored text as a download, as-is.
 * Import refuses such a file with the same words.
 *
 * A named song (windsor#433, record `2026-10-02-song-library`) is never
 * asked about: nothing in it is at risk, so the reload reopens it at once
 * and says so, or says why it couldn't and starts a new song.
 */
import type { FormatRefusal } from '@windsor/engine';
import { upgradeSong } from '@windsor/engine';
import type { AppCtx } from './context';
import type { ConfirmRequest } from './metadataModal';
import type { SessionRecord, StoredSong } from './songAutosave';
import { isNamedSession } from './songAutosave';
import type { OpenProblem } from './songSessionStorage';

/** The file name the refused record downloads as. */
export const OLD_SONG_FILE = 'old-song.json';

/** When the record was written, in the reader's locale; the raw text if it is not a date. */
export function savedWhen(stored: StoredSong): string {
  const date = new Date(stored.updated);
  return Number.isNaN(date.getTime())
    ? stored.updated
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** The question the console asks at boot. */
export function restoreRequest(stored: StoredSong): ConfirmRequest {
  return {
    title: 'Restore your last session?',
    body:
      `Your last song was saved in this browser on ${savedWhen(stored)}. ` +
      'Restore it, or start on a new song? The saved song is kept until your first edit replaces it.',
    ok: 'Restore',
  };
}

/** Why a song's text cannot be opened by this build, or null when it can (or is not JSON — the open reports that). */
export function songRefusal(text: string): FormatRefusal | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  return upgradeSong(raw).refused ?? null;
}

/** The question for a record this build cannot read: download it as-is, or start fresh. */
export function refusedRequest(stored: StoredSong, refusal: FormatRefusal): ConfirmRequest {
  return {
    title: "Your last song can't be opened",
    body:
      `Your last song, saved in this browser on ${savedWhen(stored)}, was ${refusal.message}. ` +
      'Download the old song to keep it as a file, or start fresh. ' +
      'The saved song is kept until your first edit replaces it.',
    ok: 'Download the old song',
    cancel: 'Start fresh',
  };
}

/** The error toast for an imported file this build cannot read; the file itself is untouched. */
export const importRefusedText = (fileName: string, refusal: FormatRefusal): string =>
  `import refused: ${fileName} was ${refusal.message}. The file is unchanged.`;

/**
 * Open the stored song the way Import opens a file, through the session's
 * one switch (which waits for the built-ins, for an older song's library
 * fill, #562), but quietly: nothing is written back until the first edit.
 * `unless` is asked immediately before the replacement; true when it opened.
 */
export async function restoreSong(
  ctx: AppCtx,
  stored: StoredSong,
  unless?: () => boolean,
): Promise<boolean> {
  const raw = JSON.parse(stored.document) as unknown;
  const restored = await ctx.songs.adopt(raw, unless ? { quiet: true, unless } : { quiet: true });
  if (restored) ctx.notify(`restored the song saved ${savedWhen(stored)}`, 'success');
  return restored;
}

/** Hand the stored text to the browser's download path, byte for byte. */
export function downloadSongText(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = OLD_SONG_FILE;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Ask, and restore on yes; a record that fails to open is reported and left
 * in place. A record this build cannot read is offered as a download instead
 * and is never opened: the answer is always false, since nothing was restored.
 * `unless` is the boot's touch check, asked again right before the restore.
 */
export async function offerRestore(
  ctx: AppCtx,
  stored: StoredSong | null,
  confirm: (request: ConfirmRequest) => Promise<boolean>,
  download: (text: string) => void = downloadSongText,
  unless?: () => boolean,
): Promise<boolean> {
  if (!stored) return false;
  const refusal = songRefusal(stored.document);
  if (refusal) {
    if (await confirm(refusedRequest(stored, refusal))) download(stored.document);
    return false;
  }
  if (!(await confirm(restoreRequest(stored)))) return false;
  try {
    return await restoreSong(ctx, stored, unless);
  } catch (error) {
    ctx.notify(
      `restore failed: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return false;
  }
}

/** Why the named song the last session left open didn't reopen, ending in the new song it starts. */
export function reopenFailedText(problem: OpenProblem): string {
  switch (problem.problem) {
    case 'refused':
      return (
        `your last song, ${problem.name || 'untitled'}, was ${problem.refusal.message}. ` +
        'It stays in your songs, unchanged — this is a new song'
      );
    case 'failed':
      return `your last song couldn't be reopened (${problem.message}) — this is a new song`;
    default:
      return 'your last song is no longer in your songs — this is a new song';
  }
}

/**
 * Reopen named song `id` at boot, with no question. `unless` is asked
 * immediately before the document is replaced; when it holds, the song is
 * left alone (`kept`) and nothing is said here.
 */
export async function reopenSong(
  ctx: AppCtx,
  id: string,
  unless?: () => boolean,
): Promise<BootOutcome> {
  const outcome = await ctx.songs.openSong(id, unless ? { unless } : {});
  if (outcome.ok) {
    ctx.notify(`reopened ${outcome.name || 'your last song'}`, 'success');
    return 'opened';
  }
  if (outcome.problem === 'touched') return 'kept';
  ctx.notify(reopenFailedText(outcome), 'warning');
  return 'new';
}

/** How the boot's song went: a song opened, the new song stayed, or the stored one was kept unopened. */
export type BootOutcome = 'opened' | 'new' | 'kept';

/**
 * Whether the user has touched the document since now: an edit, or any
 * replacement (Import, New song, an open). Taken as the console boots, so
 * a boot delayed behind the database (an older tab blocking its upgrade)
 * never replaces what the user did meanwhile.
 */
export function touchWatch(ctx: AppCtx): () => boolean {
  const replacements = ctx.songs.replacements;
  return () => ctx.model.changed || ctx.songs.replacements !== replacements;
}

/** What the boot says when it leaves the stored song alone because the user has already started. */
export function keptText(stored: SessionRecord): string {
  return isNamedSession(stored)
    ? 'your last song is in your songs — this song stays open'
    : 'your last session is kept until your first edit — this song stays open';
}

function kept(ctx: AppCtx, stored: SessionRecord | null): 'kept' {
  if (stored) ctx.notify(keptText(stored));
  return 'kept';
}

/**
 * The reload (windsor#433 decision 9): the session record names a named
 * song, which reopens at once, or holds an untitled one, which is offered
 * as before. When `touched` says the user has already edited or replaced
 * the document, nothing is opened or asked: the stored song is kept and
 * the reader told where it is. It is asked first, and again by the switch
 * immediately before it would replace the document, after every read it
 * waited on.
 */
export async function bootSong(
  ctx: AppCtx,
  stored: SessionRecord | null,
  confirm: (request: ConfirmRequest) => Promise<boolean>,
  options: { download?: (text: string) => void; touched?: () => boolean } = {},
): Promise<BootOutcome> {
  const { touched } = options;
  if (touched?.()) return kept(ctx, stored);
  if (stored && isNamedSession(stored)) {
    const outcome = await reopenSong(ctx, stored.songId, touched);
    return outcome === 'kept' ? kept(ctx, stored) : outcome;
  }
  if (await offerRestore(ctx, stored, confirm, options.download, touched)) return 'opened';
  return touched?.() ? kept(ctx, stored) : 'new';
}
