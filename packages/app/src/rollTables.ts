/**
 * The Roll device's sizes and colours (windsor#602, epic windsor#596; record
 * `2026-10-04-roll-sequencer`, look
 * `docs/research/2026-10-04-piano-roll/roll.html`, approved in windsor#597).
 * Every number the roll draws with is written once, here: the models take
 * these as defaults, and the CSS reads `ROLL_DEVICE_PX` and `ROLL_COLORS`
 * as custom properties the device sets, as `SEQUENCER_DEVICE_PX` is set.
 */
import type { ScaleName } from '@windsor/engine';

/** One Snap choice: its label and its grain in ticks on the 24 PPQ grid. */
export interface RollSnap {
  readonly label: string;
  readonly ticks: number;
}

/** Snap (decision 2): 1/4 to 1/32, the triplets, and Off at one tick. */
export const ROLL_SNAPS: readonly RollSnap[] = [
  { label: '1/4', ticks: 24 },
  { label: '1/8', ticks: 12 },
  { label: '1/8T', ticks: 8 },
  { label: '1/16', ticks: 6 },
  { label: '1/16T', ticks: 4 },
  { label: '1/32', ticks: 3 },
  { label: 'Off', ticks: 1 },
];

/** The Snap a roll opens on: 1/16. */
export const ROLL_SNAP_DEFAULT = 3;

/** The ↕ zoom's row heights, in px. */
export const ROLL_ROW_PX: readonly number[] = [5, 7, 9, 12, 15, 19];

/** The ↕ zoom each view opens on, an index into `ROLL_ROW_PX`: 7 px in the device, 15 px expanded. */
export const ROLL_ROW_DEFAULT = { device: 1, wide: 4 } as const;

/** The rows' geometry (decision 4). */
export const ROLL_ROWS = {
  /** A row outside the scale that holds a note, under Keys: Scale. */
  thinPx: 3,
  /** Fold's tallest row. */
  foldMaxPx: 16,
  /** A key is named from this row height up… */
  labelPx: 9,
  /** …and a C key from this one. */
  cLabelPx: 5,
} as const;

/** The black keys' pitch classes. */
export const ROLL_BLACK_PCS: readonly number[] = [1, 3, 6, 8, 10];

/** The pitches the roll always shows, C1 to C7; a note outside widens it. */
export const ROLL_PITCH_RANGE = { low: 24, high: 96 } as const;

/** The pitch an empty roll opens centred on, so the C4 octave is in view. */
export const ROLL_EMPTY_CENTRE_PITCH = 66;

/** The ↔ zoom, in px per beat: its bounds, the factor one − or + moves it by, and Fit's inset. */
export const ROLL_TIME_ZOOM = { minBeatPx: 6, maxBeatPx: 120, step: 1.4, fitInsetPx: 2 } as const;

/** Snap lines are drawn while one snap is at least this many px wide. */
export const ROLL_SNAP_LINE_MIN_PX = 4;

/** The px per beat a roll draws at before its pane has a width to fit. */
export const ROLL_UNFIT_BEAT_PX = 20;

/** The notes and stems are drawn this many screens either side of the notes pane's view. */
export const ROLL_DRAW_MARGIN_SCREENS = 1;

/** The most notes and repeats one paint draws one by one; past it, repeats are drawn as runs. */
export const ROLL_DRAW_BUDGET = 2048;

/** A note's look (decision 6): fill `floor + span × velocity` percent, a label where it fits. */
export const ROLL_NOTE = {
  fillFloorPct: 45,
  fillSpanPct: 55,
  labelMinHPx: 11,
  labelMinWPx: 26,
  minWPx: 3,
} as const;

/** A key label's font size: the row less `inset`, between `min` and `max` px. */
export const ROLL_KEY_FONT = { min: 7, max: 9.5, inset: 3 } as const;

/** A velocity stem's height: velocity × (the lane less `insetPx`), at least `minPx`. */
export const ROLL_STEM = { insetPx: 8, minPx: 2 } as const;

/** The panes' fixed sizes, also set on the device as custom properties. */
export const ROLL_PANE_PX = {
  /** The keyboard's width. */
  keys: 44,
  /** The ruler and chord strip's height. */
  head: 32,
  /** The velocity lane's height. */
  vel: 34,
  /** What the followers scroll past the notes, so they stay level beside the body's scrollbars. */
  overhang: 24,
} as const;

/** Custom property → px, set on the sequencer row with `SEQUENCER_DEVICE_PX`. */
export const ROLL_DEVICE_PX: Readonly<Record<string, number>> = {
  /** The device's narrowest width; it grows to the pane's. */
  '--roll-min-w': 620,
  /** One control column's width. */
  '--roll-ctl-w': 112,
  /** The space between the two control columns. */
  '--roll-ctl-gap': 10,
  /** A stepper's, a picker's and a switch's height. */
  '--roll-ctl-h': 20,
  /** The keyboard's width. */
  '--roll-keys-w': ROLL_PANE_PX.keys,
  /** The ruler and chord strip's height. */
  '--roll-head-h': ROLL_PANE_PX.head,
  /** The velocity lane's height. */
  '--roll-vel-h': ROLL_PANE_PX.vel,
  /** The bar ruler's share of the head. */
  '--roll-ruler-h': 17,
  /** A chord block's height in the strip. */
  '--roll-chord-h': 14,
};

/** Custom property → colour, set on the device (decisions 5 and 6, the mockup's tokens). */
export const ROLL_COLORS: Readonly<Record<string, string>> = {
  /** The guide on the keys: the chord's root, its other tones, the key's scale tones. */
  '--roll-k-root': 'rgba(224, 164, 78, 0.88)',
  '--roll-k-chord': 'rgba(224, 164, 78, 0.42)',
  '--roll-k-scale': 'rgba(220, 227, 227, 0.11)',
  /** The keys and rows, white and black, and a thin row's. */
  '--roll-key-white': '#1b2023',
  '--roll-key-black': '#0f1214',
  '--roll-key-out': '#48535a',
  '--roll-row-white': '#15191b',
  '--roll-row-black': '#101315',
  '--roll-row-thin': '#0b0d0e',
  /** A row's separator, and a C row's brighter one. */
  '--roll-sep': '#0c0f10',
  '--roll-c-sep': '#2a3236',
  /** The beat and snap lines (the bar line is `--line-bright`). */
  '--roll-beat-line': '#262d31',
  '--roll-snap-line': '#1b2124',
  /** A note outside the key; its edge is `--hot`. */
  '--roll-n-out': '#7d7590',
  /** A lit chord block's ground. */
  '--roll-chord-lit': 'rgba(224, 164, 78, 0.16)',
  /** The repeats' hatch. */
  '--roll-hatch-a': 'rgba(0, 0, 0, 0.22)',
  '--roll-hatch-b': 'rgba(0, 0, 0, 0.12)',
  /** A ghost repeat's opacity, and its stem's. */
  '--roll-ghost': '0.38',
  '--roll-ghost-stem': '0.3',
};

/** Bars are counted to a tenth in the summary and the Loop readout. */
export const ROLL_BAR_FRACTIONS = 10;

/** How the summary names the song's scale: `A minor`. */
export const ROLL_SCALE_NAMES: Readonly<Record<ScaleName, string>> = {
  major: 'major',
  naturalMinor: 'minor',
  dorian: 'dorian',
  mixolydian: 'mixolydian',
  lydian: 'lydian',
  pentatonicMajor: 'major pentatonic',
  pentatonicMinor: 'minor pentatonic',
};

/** A scale given as its own offsets. */
export const ROLL_CUSTOM_SCALE_NAME = 'custom scale';
