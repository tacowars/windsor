/**
 * The Songs section's list, pure (windsor#434, record
 * `2026-10-02-song-library`, mockup `docs/design/song-library-mockup.html`):
 * the filter chips, search, the three sorts, the rows a table draws, the
 * `<shown> of <total>` count, the tags Save as… suggests and the relative
 * times. It takes the session's list entries and returns values; the
 * section builds DOM from them and holds no rule of its own.
 */
import { CHORD_NOTE_NAMES, TEMPLATE_TAG } from '@windsor/engine';
import type { SongFacts, SongKey } from './songFacts';
import type { SongListEntry } from './songLibrary';
import type { RelativeTimeSteps, SongSort } from './songListTables';
import {
  FILTER_ALL_LABEL,
  FILTER_TEMPLATE_LABEL,
  FILTER_UNTAGGED_LABEL,
  CLOCK_DIGITS,
  MONTH_ABBREVIATIONS,
  RELATIVE_TIME_STEPS,
  SONG_CELL_NONE,
} from './songListTables';

/** One tag at a time: every song, the songs with no tag, or the songs carrying `tag` (`template` included). */
export type SongFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'untagged' }
  | { readonly kind: 'tag'; readonly tag: string };

export const ALL_SONGS: SongFilter = { kind: 'all' };

/** What the list shows: the search text, the filter chip that is on, and the sort. */
export interface SongListView {
  readonly query: string;
  readonly filter: SongFilter;
  readonly sort: SongSort;
}

export interface FilterChip {
  readonly filter: SongFilter;
  readonly label: string;
  /** The `★ template` chip, drawn in the template colour. */
  readonly template: boolean;
}

/** One row of the table, every cell as text. */
export interface SongRow {
  readonly id: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly bpm: string;
  readonly meter: string;
  readonly bars: string;
  readonly key: string;
  readonly edited: string;
  /** The open song's row: marked `open`, and it has no Open button. */
  readonly open: boolean;
  /** Tagged `template`: its action is New from. */
  readonly template: boolean;
  /** Why this build can't open it, or null; such a row offers only Export .json and Delete…. */
  readonly refusal: string | null;
}

export interface SongList {
  readonly rows: readonly SongRow[];
  readonly shown: number;
  readonly total: number;
}

/** What the rows need beyond the entries: which song is open, and the clock. */
export interface SongListContext {
  readonly openId: string | null;
  readonly now: Date;
}

/** The name a song with none reads as. */
export const UNTITLED = 'Untitled';

export const isTemplate = (song: { readonly tags: readonly string[] }): boolean =>
  song.tags.includes(TEMPLATE_TAG);

export const sameFilter = (a: SongFilter, b: SongFilter): boolean =>
  a.kind === b.kind && (a.kind !== 'tag' || (b.kind === 'tag' && a.tag === b.tag));

/** Every tag the songs carry but `template`, once each, sorted. */
export function tagsInUse(entries: readonly { readonly tags: readonly string[] }[]): string[] {
  const tags = new Set(entries.flatMap((entry) => entry.tags));
  tags.delete(TEMPLATE_TAG);
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/** The filter row's chips: `all`, each tag in use sorted, `★ template`, `untagged`. */
export function filterChips(entries: readonly SongListEntry[]): FilterChip[] {
  return [
    { filter: ALL_SONGS, label: FILTER_ALL_LABEL, template: false },
    ...tagsInUse(entries).map((tag) => ({
      filter: { kind: 'tag', tag } as const,
      label: tag,
      template: false,
    })),
    { filter: { kind: 'tag', tag: TEMPLATE_TAG }, label: FILTER_TEMPLATE_LABEL, template: true },
    { filter: { kind: 'untagged' }, label: FILTER_UNTAGGED_LABEL, template: false },
  ];
}

/** `filter` when it is one of the chips, else `all`: a tag no song carries any more has no chip. */
export function activeFilter(entries: readonly SongListEntry[], filter: SongFilter): SongFilter {
  return filterChips(entries).some((chip) => sameFilter(chip.filter, filter)) ? filter : ALL_SONGS;
}

export function matchesFilter(song: SongListEntry, filter: SongFilter): boolean {
  if (filter.kind === 'all') return true;
  if (filter.kind === 'untagged') return song.tags.length === 0;
  return song.tags.includes(filter.tag);
}

/** A case-insensitive search of the name; an empty query matches every song. */
export function matchesQuery(song: SongListEntry, query: string): boolean {
  const wanted = query.trim().toLocaleLowerCase();
  return wanted === '' || song.name.toLocaleLowerCase().includes(wanted);
}

const byName = (a: SongListEntry, b: SongListEntry): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) ||
  a.id.localeCompare(b.id);

/** ISO 8601 times compare as text; the newest first, then by name. */
const newest =
  (field: 'updated' | 'created') =>
  (a: SongListEntry, b: SongListEntry): number =>
    b[field].localeCompare(a[field]) || byName(a, b);

const SORTS: Readonly<Record<SongSort, (a: SongListEntry, b: SongListEntry) => number>> = {
  edited: newest('updated'),
  name: byName,
  created: newest('created'),
};

/** The entries in `sort`'s order: last edited and created newest first, name A to Z. */
export function sortSongs(entries: readonly SongListEntry[], sort: SongSort): SongListEntry[] {
  return [...entries].sort(SORTS[sort]);
}

const numberCell = (value: number | null): string =>
  value === null ? SONG_CELL_NONE : String(value);

/** A key as the transport strip spells it: `A naturalMinor`. */
export function keyLabel(key: SongKey | null): string {
  if (key === null) return SONG_CELL_NONE;
  return `${CHORD_NOTE_NAMES[key.root] ?? String(key.root)} ${key.scale}`;
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * How long ago `iso` was, as the mockup writes it: `12 s ago`, `5 min ago`,
 * `today 09:12`, `yesterday 23:41`, `28 Sep`, and `28 Sep 2025` from another
 * year. A time that is not a date reads as written.
 */
export function relativeTime(
  iso: string,
  now: Date,
  steps: RelativeTimeSteps = RELATIVE_TIME_STEPS,
): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / steps.msPerSecond));
  if (seconds < steps.secondsUntilMinutes) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / steps.secondsUntilMinutes);
  if (minutes < steps.minutesUntilClock) return `${minutes} min ago`;
  const clock = [then.getHours(), then.getMinutes()]
    .map((part) => String(part).padStart(CLOCK_DIGITS, '0'))
    .join(':');
  if (sameDay(then, now)) return `today ${clock}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(then, yesterday)) return `yesterday ${clock}`;
  const date = `${then.getDate()} ${MONTH_ABBREVIATIONS[then.getMonth()] ?? ''}`;
  return then.getFullYear() === now.getFullYear() ? date : `${date} ${then.getFullYear()}`;
}

function row(entry: SongListEntry, context: SongListContext): SongRow {
  return {
    id: entry.id,
    name: entry.name || UNTITLED,
    tags: entry.tags,
    bpm: numberCell(entry.bpm),
    meter: entry.meter,
    bars: numberCell(entry.bars),
    key: keyLabel(entry.key),
    edited: relativeTime(entry.updated, context.now),
    open: entry.id === context.openId,
    template: isTemplate(entry),
    refusal: entry.refusal?.message ?? null,
  };
}

/** The rows `view` shows, in its order, and the `<shown> of <total>` count. */
export function songList(
  entries: readonly SongListEntry[],
  view: SongListView,
  context: SongListContext,
): SongList {
  const filter = activeFilter(entries, view.filter);
  const shown = entries.filter(
    (entry) => matchesFilter(entry, filter) && matchesQuery(entry, view.query),
  );
  const rows = sortSongs(shown, view.sort).map((entry) => row(entry, context));
  return { rows, shown: rows.length, total: entries.length };
}

/**
 * The open song's entry with what the open document says now, so a rename
 * or a tag edit shows in its row before the autosave has written the index.
 */
export function withOpenFacts(
  entries: readonly SongListEntry[],
  openId: string | null,
  facts: SongFacts,
): SongListEntry[] {
  return entries.map((entry) =>
    entry.id === openId ? { ...entry, ...facts, version: entry.version } : entry,
  );
}

/** A tag as the engine stores it: trimmed and lowercased; empty when it is no tag. */
export const cleanTag = (text: string): string => text.trim().toLowerCase();

/** `tags` with the tags typed in `text` (a comma parts several) added, once each, in order. */
export function addTags(tags: readonly string[], text: string): string[] {
  const out = [...tags];
  for (const tag of text.split(',').map(cleanTag))
    if (tag !== '' && !out.includes(tag)) out.push(tag);
  return out;
}

/** The tags Save as… offers: those in use, sorted, then `template` always; none already chosen. */
export function tagSuggestions(
  entries: readonly SongListEntry[],
  chosen: readonly string[],
): string[] {
  return [...tagsInUse(entries), TEMPLATE_TAG].filter((tag) => !chosen.includes(tag));
}

/**
 * The tags Save as… starts with: the song's own, plus the tag filter that is
 * on. The filter goes through `activeFilter` first, so a tag no song carries
 * any more (its chip gone, `all` lit) is never preselected.
 */
export function initialTags(
  tags: readonly string[],
  entries: readonly SongListEntry[],
  filter: SongFilter,
): string[] {
  const active = activeFilter(entries, filter);
  return active.kind === 'tag' ? addTags(tags, active.tag) : [...tags];
}
