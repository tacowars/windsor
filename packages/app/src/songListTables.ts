/**
 * The Songs section's vocabulary and tunables (windsor#434, record
 * `2026-10-02-song-library`, mockup `docs/design/song-library-mockup.html`):
 * the sorts, the filter chips' labels, the relative-time steps and the
 * strip's refresh. `songListModel.ts` takes them; the words are the mockup's.
 */

/** How the list is ordered: the sort select's three options, in the mockup's order. */
export type SongSort = 'edited' | 'name' | 'created';

export const SONG_SORTS: readonly { readonly value: SongSort; readonly label: string }[] = [
  { value: 'edited', label: 'Last edited' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Created' },
];

/** The filter chips that are not a tag: every song, and the songs with no tag. */
export const FILTER_ALL_LABEL = 'all';
export const FILTER_UNTAGGED_LABEL = 'untagged';
/** The template chip's label; the tag itself is the engine's `TEMPLATE_TAG`. */
export const FILTER_TEMPLATE_LABEL = '★ template';

/** The steps a relative time reads in: seconds, then minutes, then the clock. */
export interface RelativeTimeSteps {
  readonly msPerSecond: number;
  /** Below this many seconds an age reads `N s ago`. */
  readonly secondsUntilMinutes: number;
  /** Below this many minutes it reads `N min ago`; past it, `today HH:MM`. */
  readonly minutesUntilClock: number;
}

export const RELATIVE_TIME_STEPS: RelativeTimeSteps = {
  msPerSecond: 1000,
  secondsUntilMinutes: 60,
  minutesUntilClock: 60,
};

/** The months a date reads in (`28 Sep`), as the mockup writes them; no locale's spelling drifts in. */
export const MONTH_ABBREVIATIONS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** A clock reads two digits an hour and a minute: `09:12`. */
export const CLOCK_DIGITS = 2;

/** How often the strip's `saved · 12 s ago` and the Edited column re-read the clock, in ms. */
export const SONG_TIME_REFRESH_MS = 10000;

/** The row menu's gap below its ⋯ button, in px. */
export const SONG_MENU_GAP_PX = 4;

/** What a missing number reads as in the table. */
export const SONG_CELL_NONE = '—';
