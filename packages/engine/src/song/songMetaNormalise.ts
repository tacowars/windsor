/**
 * A song's own name and tags (windsor#440; record `2026-10-02-song-library`):
 * the document's `meta` section, read so an exported file carries them and
 * the browser library's index is only a cache. Never refuses: junk is
 * dropped and reported, and a section with an empty name and no tags is
 * absent, as `groups` and `automation` are.
 */
import type { FieldNormaliser } from './arrangementFields';
import { isRecord, show } from './arrangementFields';
import type { SongMeta } from './arrangementDocument';
import { SONG_META_LIMITS } from './songMetaTables';
import type { SongMetaLimits } from './songMetaTables';

const META_KEYS = ['name', 'tags'];

/** The `meta` section, or undefined when it holds nothing. */
export function normaliseSongMeta(
  raw: unknown,
  n: FieldNormaliser,
  limits: SongMetaLimits = SONG_META_LIMITS,
): SongMeta | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    n.correction(`meta: ${show(raw)} is not an object — dropped`);
    return undefined;
  }
  n.dropUnknown(raw, META_KEYS, 'meta');
  const name = normaliseName(raw.name, n, limits);
  const tags = normaliseTags(raw.tags, n, limits);
  return name === '' && tags.length === 0 ? undefined : { name, tags };
}

/** At most `length` code points, so a cut never splits a surrogate pair. */
function cut(text: string, length: number): string {
  return [...text].slice(0, length).join('');
}

function tooLong(text: string, length: number): boolean {
  return [...text].length > length;
}

function normaliseName(raw: unknown, n: FieldNormaliser, limits: SongMetaLimits): string {
  if (raw === undefined) return '';
  if (typeof raw !== 'string') {
    n.correction(`meta.name: ${show(raw)} is not a name — using ""`);
    return '';
  }
  const name = raw.trim();
  if (!tooLong(name, limits.nameLength)) return name;
  n.correction(`meta.name: longer than ${limits.nameLength} characters — cut`);
  return cut(name, limits.nameLength).trimEnd();
}

/**
 * Each tag trimmed and lowercased, then cut; empties and repeats dropped,
 * first order kept; the list cut to the count limit.
 */
function normaliseTags(raw: unknown, n: FieldNormaliser, limits: SongMetaLimits): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`meta.tags: ${show(raw)} is not a list of tags — dropped`);
    return [];
  }
  const out: string[] = [];
  raw.forEach((entry: unknown, i) => {
    const path = `meta.tags[${i}]`;
    if (typeof entry !== 'string') {
      n.correction(`${path}: ${show(entry)} is not a tag — dropped`);
      return;
    }
    let tag = entry.trim().toLowerCase();
    if (tooLong(tag, limits.tagLength)) {
      n.correction(`${path}: longer than ${limits.tagLength} characters — cut`);
      tag = cut(tag, limits.tagLength).trimEnd();
    }
    if (tag !== '' && !out.includes(tag)) out.push(tag);
  });
  if (out.length <= limits.tagCount) return out;
  n.correction(`meta.tags: ${out.length} tags — only the first ${limits.tagCount} are kept`);
  return out.slice(0, limits.tagCount);
}
