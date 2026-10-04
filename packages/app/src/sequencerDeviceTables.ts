/**
 * The sequencer device's sizes (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decisions 1, 4 and 5; the look is
 * `docs/research/2026-09-30-sequencer-rack/grid.html`). As the insert rack
 * does with `INSERT_RACK_PX`, `sequencerDevice.ts` sets each entry on the
 * pane's row as a CSS custom property and `console.css` reads it, so every
 * number is written once, here.
 */
import { PERC_COLOR, PITCH_COLOR } from './consoleColors';
import { ROLL_DEVICE_PX } from './rollTables';
import type { LaneTone } from './songViewTables';

/** The Grid's step rows, top down, in px: the step number, note, degree, Oct, A, S, ratchet. */
export const GRID_HEAD_ROWS_PX: readonly number[] = [12, 18, 18, 18, 18, 18, 14];

/** The gap between a step column's cells, in px. */
export const STRIP_ROW_GAP_PX = 2;

/** The height of a column's step rows: what the lane names' corner matches, so a name sits level with its lane. */
export const stripHeadPx = (
  rows: readonly number[] = GRID_HEAD_ROWS_PX,
  gap = STRIP_ROW_GAP_PX,
): number => rows.reduce((sum, row) => sum + row, 0) + gap * Math.max(0, rows.length - 1);

/** The Arp's step cells' height (windsor#370): roomier than the Grid's 18, as tacowars asked of the Chord. */
export const ARP_CELL_PX = 20;

/** The gap between an Arp step column's held rows, in px. */
export const ARP_ROW_GAP_PX = 4;

/** The Arp's step rows, top down, in px: the step number, `♪ — ·`, Oct, A, S, ratchet. */
export const ARP_HEAD_ROWS_PX: readonly number[] = [
  12,
  ARP_CELL_PX,
  ARP_CELL_PX,
  ARP_CELL_PX,
  ARP_CELL_PX,
  14,
];

/** The Euclid's row cells' heights (windsor#393): the ratchet and trigger rows, and the accent lane's cell. */
export const EUCLID_ROW_PX = { ratchet: 14, trigger: 22, accent: 16 } as const;

/** The space between the Euclid's rows, which also leaves the 2 px playhead ring room at the scroller's edges. */
export const EUCLID_ROW_GAP_PX = 2;

/** The Euclid's Lanes rule: the + Lane picker's height. */
export const EUCLID_RULE_PX = 18;

/**
 * The Euclid's rows held at the top of its scroller, each with the row gap
 * above it: the ratchet row, the trigger row and the Lanes rule.
 */
export const euclidHeadPx = (gap = EUCLID_ROW_GAP_PX): number =>
  EUCLID_ROW_PX.ratchet + EUCLID_ROW_PX.trigger + EUCLID_RULE_PX + 3 * gap;

/** A converted device's height (the insert rack's `--rack-h` is 196); the harmony card matches it. */
export const SEQUENCER_DEVICE_H_PX = 244;

/** The Figure's held rows (windsor#490, figure.html): the cell number, tone, Oct, Vel, A, S, ratchet. */
export const FIGURE_HEAD_ROWS_PX: readonly number[] = [12, 18, 18, 18, 18, 18, 14];

/** The gap between a Figure step column's held rows: 1 px, so two lanes still fit under the tabs. */
export const FIGURE_ROW_GAP_PX = 1;

/** Custom property → px. */
export const SEQUENCER_DEVICE_PX: Readonly<Record<string, number>> = {
  /** A converted device's height. */
  '--seq-h': SEQUENCER_DEVICE_H_PX,
  /** The side rail: dot, name, the device's own buttons, the region, Split and Delete. */
  '--seq-rail': 24,
  /** A step column's width. */
  '--step-w': 32,
  /* The Chord's own sizes (windsor#369), measured off tacowars's mockup of
     the device at 244 px: its Play section and its strip, never the Grid's. */
  /** A Chord step column's width: the Grid's and a third, for its bigger dials. */
  '--chord-step-w': 42,
  /** The space between two Chord step columns; with the width, a 48 px step pitch. */
  '--chord-step-gap': 6,
  /** A Chord step's Oct, Inv, Dur and Rep dial height; the Hit or Rest tile takes what is left. */
  '--chord-dial-h': 21,
  /** The space between a Chord step's tile and its dials, and between the dials. */
  '--chord-row-gap': 5,
  /** The space under a Chord step's last dial, to the device's edge. */
  '--chord-strip-foot': 10,
  /** The Chord's Play section's inset from the rail. */
  '--chord-inset': 12,
  /** The space between the Chord's Play columns, so Base step and Voicing clear the tiles. */
  '--chord-col-gap': 13,
  /** The Base step and Voicing selects' width. */
  '--chord-field-w': 120,
  /** Base step's and Follow's inset from the column's ends, so the three fields sit level with the Hit tile and Delete last. */
  '--chord-fields-pad': 33,
  /** The Hit and Rest tiles' and Delete last's width; a longer chord name widens the column. */
  '--chord-tile-w': 110,
  /** The space between the Hit and Rest tiles. */
  '--chord-tile-gap': 10,
  /** The knob strip's padding either side of its knobs, behind the rule that parts it from the Play columns. */
  '--chord-knob-pad': 9,
  /* The Arp's own sizes (windsor#370), its Play section laid out as the
     Chord's: inset from the rail, columns apart, a knob strip behind a rule. */
  /** The Arp's Play section's inset from the rail. */
  '--arp-inset': 12,
  /** The space between the Arp's Play columns. */
  '--arp-col-gap': 13,
  /** The Style, Rate, Voicing, Retrigger and Seed fields' width. */
  '--arp-field-w': 112,
  /** The knob strip's padding either side of its knobs, behind its rule. */
  '--arp-knob-pad': 9,
  /** The Reseed icon button beside the seed field, square. */
  '--arp-reseed': 22,
  /** An Arp step cell's height: `♪ — ·`, Oct, A and S. */
  '--arp-cell-h': ARP_CELL_PX,
  /** The space between an Arp step's held rows. */
  '--arp-row-gap': ARP_ROW_GAP_PX,
  /** The space between two Arp step columns. */
  '--arp-step-gap': 6,
  /** The Arp's held step rows, which its lane names' corner matches. */
  '--arp-strip-head-h': stripHeadPx(ARP_HEAD_ROWS_PX, ARP_ROW_GAP_PX),
  /* The Euclid's own sizes (windsor#393), off tacowars's mockup
     (euclid.html) and laid out as the Arp's: Play inset from the rail, its
     columns apart, a knob strip behind a rule; the rows' cells 22 px. */
  /** The Euclid's Play section's inset from the rail. */
  '--euclid-inset': 12,
  /** The space between the Euclid's Play columns. */
  '--euclid-col-gap': 13,
  /** The Note, Steps and Rotate boxes', the Step select's and Capture's width. */
  '--euclid-field-w': 96,
  /** The knob strip's padding either side of its knobs, behind its rule. */
  '--euclid-knob-pad': 9,
  /** A row cell's width, every row's, so the rows line up step for step. */
  '--euclid-cell-w': 22,
  /** The space between two cells of a row. */
  '--euclid-cell-gap': 2,
  /** The trigger row's cell height. */
  '--euclid-trigger-h': EUCLID_ROW_PX.trigger,
  /** The ratchet row's cell height. */
  '--euclid-ratchet-h': EUCLID_ROW_PX.ratchet,
  /** The accent lane's on/off cell height, centred in its --lane-h row. */
  '--euclid-accent-h': EUCLID_ROW_PX.accent,
  /** The row names' column: a lane's name, ×, − length + and hover reading. */
  '--euclid-names-w': 104,
  /** The + Lane picker and the Lanes rule's height. */
  '--euclid-rule-h': EUCLID_RULE_PX,
  /** The space between rows, and around the playhead ring at the scroller's edges. */
  '--euclid-row-gap': EUCLID_ROW_GAP_PX,
  /** The Density page's modulator column: wide enough for LFOBARS · LFOHZ · WALK. */
  '--euclid-mod-w': 150,
  /** The Density plot's narrowest width; it takes the room the Pattern page leaves. */
  '--euclid-plot-min-w': 160,
  /** The extra space before a step that starts a counted beat (windsor#431, `meterGrid.ts`). */
  '--beat-gap': 4,
  /** The wider space before a step that starts a new bar, in the Grid, Chord and Euclid strips. */
  '--bar-gap': 10,
  /** One modulation lane's height. */
  '--lane-h': 42,
  /** The lane names' column, with + Lane in its corner. */
  '--names-w': 96,
  /** The step rows held at the top of the strip. */
  '--strip-head-h': stripHeadPx(),
  /** A column holding a picker and a button. */
  '--seq-wide-col': 96,
  /** A knob's dial in the device, the insert rack's small dial. */
  '--seq-dial': 30,
  /* The Figure's own sizes (windsor#490), off tacowars's mockup
     (figure.html): the Arp's Play columns and the Grid's 32 px strip under
     the Euclid's 20 px page tabs. */
  /** The page tabs' row, as the Euclid's. */
  '--figure-tabs-h': 20,
  /** The Rate, Seed and Randomize column's width. */
  '--figure-field-w': 100,
  /** The space between a Figure step's held rows. */
  '--figure-row-gap': FIGURE_ROW_GAP_PX,
  /** The Figure's held step rows, which its lane names' corner matches. */
  '--figure-strip-head-h': stripHeadPx(FIGURE_HEAD_ROWS_PX, FIGURE_ROW_GAP_PX),
  /** A schedule stage chip's height. */
  '--figure-chip-h': 26,
  /** The Source picker's width. */
  '--figure-source-w': 140,
  /** A Process knob's width in its row of two. */
  '--figure-row-knob-w': 56,
  /** One choice in the tone picker, square. */
  '--figure-pick': 30,
  /* The Roll's own sizes (windsor#602), off tacowars's mockup (roll.html),
     written once in `rollTables.ts`. */
  ...ROLL_DEVICE_PX,
};

/** A part's accent on its device (the mockup's `--kc`): the dot, the knob arcs, the lit cells. */
export const DEVICE_ACCENT: Readonly<Record<LaneTone, string>> = {
  perc: PERC_COLOR,
  pitch: PITCH_COLOR,
  none: 'var(--ink-faint)',
};
