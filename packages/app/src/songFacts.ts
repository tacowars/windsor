/**
 * What the song library's list shows of a song (windsor#433, record
 * `2026-10-02-song-library`): its declared format version, its name and tags
 * (the document's `meta`, windsor#440), and the transport and key a row
 * reads. One pure function derives them from the stored text at every write,
 * so the index is a cache of the document and never holds a name or a tag
 * the document doesn't.
 *
 * It reads the text as written and never normalises it: a song this build
 * cannot read still gets a row, and its declared version is what the list
 * judges it by. A missing or junk field reads as empty rather than throwing.
 */
import { FOUR_FOUR } from '@windsor/engine';

/** A song's key as its harmony names it: the root pitch class and the scale's name. */
export interface SongKey {
  readonly root: number;
  readonly scale: string;
}

/** The index fields derived from a song's text; the store adds `id`, `created` and `updated`. */
export interface SongFacts {
  /** The document's declared `version`, or null when it declares none. */
  readonly version: number | null;
  readonly name: string;
  readonly tags: readonly string[];
  readonly bpm: number | null;
  /** `transport.meter`; a song without one is 4/4. */
  readonly meter: string;
  readonly bars: number | null;
  readonly key: SongKey | null;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numberOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function parse(text: string): Raw {
  try {
    const raw: unknown = JSON.parse(text);
    return isRecord(raw) ? raw : {};
  } catch {
    return {};
  }
}

function keyOf(harmony: unknown): SongKey | null {
  if (!isRecord(harmony)) return null;
  const root = numberOr(harmony['root']);
  const scale = harmony['scale'];
  return root === null || typeof scale !== 'string' ? null : { root, scale };
}

/** The index fields of the song whose export text is `text`. */
export function songFacts(text: string): SongFacts {
  const raw = parse(text);
  const meta = isRecord(raw['meta']) ? raw['meta'] : {};
  const transport = isRecord(raw['transport']) ? raw['transport'] : {};
  const tags = Array.isArray(meta['tags']) ? meta['tags'] : [];
  const meter = transport['meter'];
  return {
    version: numberOr(raw['version']),
    name: typeof meta['name'] === 'string' ? meta['name'] : '',
    tags: tags.filter((tag): tag is string => typeof tag === 'string'),
    bpm: numberOr(transport['bpm']),
    meter: typeof meter === 'string' ? meter : FOUR_FOUR,
    bars: numberOr(transport['bars']),
    key: keyOf(raw['harmony']),
  };
}
