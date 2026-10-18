/**
 * The Roll device's sizes and colours (windsor#602, epic windsor#596; record
 * `2026-10-04-roll-sequencer`, look
 * `docs/research/2026-10-04-piano-roll/roll.html`, approved in windsor#597).
 * Every number the roll draws with is written once, here: the models take
 * these as defaults, and the CSS reads `ROLL_DEVICE_PX` and `ROLL_COLORS`
 * as custom properties the device sets, as `SEQUENCER_DEVICE_PX` is set.
 */
/** One Snap choice: its label and its grain in ticks on the 24 PPQ grid. */
export interface RollSnap {
  readonly label: string;
  readonly ticks: number;
}

/** Snap Off's grain: one tick, which Quantise has no step to snap to. */
export const ROLL_SNAP_OFF_TICKS = 1;

/** Snap (decision 2): 1/4 to 1/32, the triplets, and Off at one tick. */
export const ROLL_SNAPS: readonly RollSnap[] = [
  { label: '1/4', ticks: 24 },
  { label: '1/8', ticks: 12 },
  { label: '1/8T', ticks: 8 },
  { label: '1/16', ticks: 6 },
  { label: '1/16T', ticks: 4 },
  { label: '1/32', ticks: 3 },
  { label: 'Off', ticks: ROLL_SNAP_OFF_TICKS },
];

/** The Snap a roll opens on: 1/16. */
export const ROLL_SNAP_DEFAULT = 3;

/**
 * The ↕ zoom's row heights, in px: continuous between these (record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decision 8).
 */
export const ROLL_ROW_ZOOM = { minPx: 4, maxPx: 24 } as const;

/** The row height each view opens on: 7 px in the device, 15 px expanded. */
export const ROLL_ROW_DEFAULT = { device: 7, wide: 15 } as const;

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

/**
 * The ↔ zoom, in px per beat (record `2026-10-18-roll-zoom-bars-and-duplicate`
 * decisions 3 and 8): in to `maxBeatPx`, so a 1/16 is 60 px wide, and out to
 * the whole region, the floor, which has no fixed number. Region's fit
 * leaves `fitInsetPx` at the right, and Loop's `loopInsetPx`, so the loop
 * brace's handle shows.
 */
export const ROLL_TIME_ZOOM = { maxBeatPx: 240, fitInsetPx: 2, loopInsetPx: 14 } as const;

/**
 * How near the view must be to a fit to sit on it: the px per beat within
 * `relative` of the fit's, and the left edge within `edgePx` of tick 0.
 */
export const ROLL_FIT_TOLERANCE = { relative: 1e-6, edgePx: 0.5 } as const;

/**
 * The zoom bars (decision 9), by pointer: `thickPx` across, a grip `gripPx`
 * along at each end of the thumb, and a thumb never shorter than `leastPx`,
 * nor than half its track. `coarse` applies whenever any pointer is coarse
 * (`COARSE_POINTER_QUERY`), where a grip is 26 × 22 px with two ridges.
 */
export const ROLL_ZOOM_BAR = {
  fine: { thickPx: 12, gripPx: 9, leastPx: 30 },
  coarse: { thickPx: 22, gripPx: 26, leastPx: 84 },
  /** The ↔ map's note ticks stand this far in from the bar's long edges, the ↕ map's pitch marks `pitchInsetPx`. */
  tickInsetPx: 4,
  pitchInsetPx: 3,
  /** The loop's tint stands this far in, and is at least `loopMinPx` long. */
  loopInsetPx: 2,
  loopMinPx: 2,
} as const;

/** The Show item (decision 2): its label, its two fits, their titles, and the hint under it. */
export const ROLL_SHOW = {
  label: 'Show',
  loop: 'Loop',
  region: 'Region',
  loopTitle: 'Fit the loop to the width',
  regionTitle: 'Fit the whole region to the width',
  hint: "drag a bar's ends to zoom",
  timeBar: 'Time: drag the middle to scroll, an end to zoom',
  rowBar: 'Rows: drag the middle to scroll, an end to zoom',
} as const;

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
  /**
   * What the followers scroll past the notes, so they stay level beside the
   * zoom bars: the ruler and the lane run on over the ↕ bar, and the keys
   * down beside the ↔ bar, at its touch thickness.
   */
  overhang: ROLL_ZOOM_BAR.coarse.thickPx,
} as const;

/**
 * The Roll device's height (record `2026-10-12-roll-note-accent-and-ratchet`
 * decision 9): the other devices' 244 px (`SEQUENCER_DEVICE_H_PX`) and the
 * Velocity row's 40, which the Roll alone takes, as `--roll-h` over its own
 * `--seq-h` (console.css).
 */
export const ROLL_DEVICE_H_PX = 284;

/** Custom property → px, set on the sequencer row with `SEQUENCER_DEVICE_PX`. */
export const ROLL_DEVICE_PX: Readonly<Record<string, number>> = {
  /** The device's height, the Roll's own. */
  '--roll-h': ROLL_DEVICE_H_PX,
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
  /** The zoom bars' thickness and a grip's length, and their touch sizes. */
  '--roll-zbar': ROLL_ZOOM_BAR.fine.thickPx,
  '--roll-zgrip': ROLL_ZOOM_BAR.fine.gripPx,
  '--roll-zbar-touch': ROLL_ZOOM_BAR.coarse.thickPx,
  '--roll-zgrip-touch': ROLL_ZOOM_BAR.coarse.gripPx,
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
  /** The ↔ zoom bar's map: the loop's tint, and a ghost repeat's tick (the first pass is `--carrier`). */
  '--roll-zbar-loop': 'rgba(224, 164, 78, 0.35)',
  '--roll-zbar-repeat': 'rgba(220, 227, 227, 0.22)',
};

/** Bars are counted to a tenth in the summary and the Loop readout. */
export const ROLL_BAR_FRACTIONS = 10;

/** A scale given as its own offsets. */
export const ROLL_CUSTOM_SCALE_NAME = 'custom scale';

/** The editing gestures (windsor#603 decisions 1 and 2, the mockup's numbers). */
export const ROLL_EDIT = {
  /** A new note's velocity. */
  addVelocity: 0.8,
  /** A press moving no more than this many px is a tap: on a note it deletes, on touch it adds. */
  tapSlopPx: 3,
  /** A note's resize edge: its last `edgePx`, or `edgeShare` of a short note. */
  edgePx: 6,
  edgeShare: 1 / 3,
  /** A press on the lane takes a stem within this many px of it. */
  stemReachPx: 7,
  /** A note's velocity range, and the steps per unit a stem drag sets it in. */
  velocityMin: 0.05,
  velocityMax: 1,
  velocitySteps: 100,
} as const;

/**
 * The lane under the notes (record `2026-10-12-roll-note-accent-and-ratchet`
 * decision 7): its three tabs, top down, each with its label and title.
 */
export const ROLL_LANES = [
  { id: 'vel', label: 'Vel', title: 'Velocity: drag a stem up or down' },
  { id: 'acc', label: 'Acc', title: "Accent: click a note's cell to accent it" },
  {
    id: 'rat',
    label: 'Rat',
    title: "Ratchet: click a note's cell for ×1 → ×2 → ×3 → ×4, shift-click back",
  },
] as const;

/** The lane a roll opens on: Vel. */
export const ROLL_LANE_DEFAULT = 'vel';

/** An Acc or Rat cell's place under its note, in px (the mockup's). */
export const ROLL_MARK_CELL = {
  /** Inset from the note's left edge, and from its right for a Rat cell. */
  insetPx: 1,
  /** An Acc cell's width: the note's, between these. */
  accMinPx: 8,
  accMaxPx: 14,
  /** A Rat cell's least width. */
  ratMinPx: 10,
} as const;

/** The cells' words, the titles of a note's marks, and the undo steps a click makes. */
export const ROLL_MARK_TEXT = {
  accCell: 'A',
  accOn: 'accented, click to clear',
  accOff: 'not accented, click to accent',
  ratTitle: (n: number): string => `ratchet ×${n}: click for more, shift-click for fewer`,
  ratShort: 'too short for a ratchet (under a 1/32)',
  accent: 'accent',
  ratchet: (n: number): string => `ratchet ×${n}`,
  undoAccent: 'Accent',
  undoRatchet: 'Ratchet',
} as const;

/** The Velocity row under the controls (decision 9): its label. */
export const ROLL_VELOCITY_ROW = { label: 'Velocity' } as const;

/** Edge scroll: a note dragged within `zonePx` of the notes pane's edge scrolls it, up to `maxPx` a frame. */
export const ROLL_EDGE_SCROLL = { zonePx: 24, maxPx: 14 } as const;

/** Audition (decision 5): how long a note sounds, and where its switch is kept. */
export const ROLL_AUDITION = { ms: 180, storageKey: 'windsor.roll.audition' } as const;

/**
 * The metronome (windsor#906 decision 5): the button's words, where its
 * on/off is kept, the built-in patch the engine plays it on, and its glyph,
 * a tapered body with a slanted pendulum arm and its weight.
 */
export const ROLL_METRONOME = {
  title: 'Metronome',
  storageKey: 'windsor.roll.metronome',
  patch: 'metronome-click',
  glyph:
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M6.2 2.5h3.6L12 14H4z"/><path d="M3.5 14h9"/>' +
    '<path d="M8 11.5 11.8 3.2"/><path d="M9.2 7.4h2.2"/></svg>',
} as const;

/** Quantise (record `2026-10-09-roll-recording` decision 10): its label, undo step and the button's words. */
export const ROLL_QUANTISE = {
  label: 'Quantize',
  undo: 'Quantize',
  all: 'All notes',
  selected: 'selected',
  to: 'to',
  off: 'snap off',
  title:
    'Snap the onsets of the selected notes, or every note when none is selected, to the nearest Snap step. Lengths are kept.',
  offTitle: 'Set a Snap to quantize to',
} as const;

/**
 * Rec (windsor#663; record `2026-10-09-roll-recording` decisions 1, 7, 8
 * and 9, the mockup's words): the switch's two sides, the label for each
 * look, the hint and the titles, the undo step a take makes, the summary of
 * a full region, and how often the console's recorder reads the playhead.
 */
export const ROLL_REC = {
  label: 'Rec',
  on: 'Rec',
  off: 'Off',
  looks: {
    'no-region': 'no region',
    off: '',
    armed: 'armed',
    paused: 'paused',
    recording: 'recording',
    full: 'region full',
  },
  hint: 'No region under the playhead',
  titles: {
    'no-region':
      "No region under the playhead: move the playhead into one of this part's regions to record",
    paused: "Armed, paused: recording resumes when the playhead enters this part's next region",
    live: 'Record what you play into the region under the playhead',
  },
  undo: 'Record',
  held: 'held, written when it stops sounding',
  full: (max: number): string =>
    `Region full: ${max} notes, the most a region holds · no new notes are recorded here`,
  pollMs: 25,
} as const;
