/**
 * A song's name and tags as text edits (windsor#433, record
 * `2026-10-02-song-library`): the `meta` a stored song is given without
 * opening it, a template's copy, and the name an imported file offers. The
 * open song's `meta` changes through the model instead, as an undoable edit.
 *
 * A stored song is edited as its text, never re-normalised: only its `meta`
 * changes, so a song the normaliser would repair is not rewritten by a
 * rename (`2026-09-28-format-versions-refuse-never-destroy`). The new `meta`
 * itself goes through the engine's normaliser, on a new song, so a name or a
 * tag is trimmed and cut exactly as an open song's would be.
 */
import type { ArrangementDocument, DocumentPartial, SongMeta } from '@windsor/engine';
import { TEMPLATE_TAG, makeArrangement } from '@windsor/engine';
import { newSong } from './songParts';

const JSON_SUFFIX = /\.json$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A document's name and tags; an absent `meta` is an empty name and no tags. */
export const metaOf = (doc: Pick<ArrangementDocument, 'meta'>): SongMeta =>
  doc.meta ?? { name: '', tags: [] };

/** `meta` as the engine normalises it, or undefined when it holds nothing. */
export function normalisedMeta(meta: SongMeta): SongMeta | undefined {
  return makeArrangement({ ...newSong(), meta }).document.meta;
}

/** The export text format: the document pretty-printed, as `DocumentModel.toJson` writes it. */
const songText = (raw: unknown): string => `${JSON.stringify(raw, null, 2)}\n`;

/** `text` with its `meta` replaced by `meta` (normalised); every other byte of the song is kept. */
export function withMeta(text: string, meta: SongMeta): string {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error('not a song');
  const next: Record<string, unknown> = { ...raw };
  const normalised = normalisedMeta(meta);
  if (normalised) next['meta'] = normalised;
  else delete next['meta'];
  return songText(next);
}

/** A template's raw document as a new song: an empty name, and its tags without `template`. */
export function templateCopy(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const meta = isRecord(raw['meta']) ? raw['meta'] : {};
  const tags = Array.isArray(meta['tags']) ? meta['tags'] : [];
  return { ...raw, meta: { name: '', tags: tags.filter((tag) => tag !== TEMPLATE_TAG) } };
}

/** The name an imported file offers: its file name without `.json`. */
export const nameFromFile = (fileName: string): string => fileName.replace(JSON_SUFFIX, '');

/**
 * The edit an import makes on open (windsor#433 decision 5): a song with no
 * name takes the file's. Null when the song has a name or the file offers none.
 */
export function fileNameAmend(
  fileName: string,
): (doc: ArrangementDocument) => DocumentPartial | null {
  const name = nameFromFile(fileName).trim();
  return (doc) =>
    name === '' || metaOf(doc).name !== '' ? null : { meta: { ...metaOf(doc), name } };
}
