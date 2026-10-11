/**
 * The Roll's Envelopes tab, its words and sizes (windsor#707, epic
 * windsor#699; the approved mockup `docs/design/roll-envelopes-mockup.html`):
 * the two tabs, the tools' hints as the mockup words them for the note
 * pane, the picker's lines, the undo steps, and the overlay's padding and
 * scale. Data only.
 */
import type { AutomationTool } from './songAutomationTables';

/** The card's pages: today's notes, and the clip envelopes. */
export type RollPage = 'notes' | 'envelopes';

/** The tab row, in order. */
export const ROLL_PAGES: readonly { readonly page: RollPage; readonly label: string }[] = [
  { page: 'notes', label: 'Notes' },
  { page: 'envelopes', label: 'Envelopes' },
];

/**
 * The tool a roll's Envelopes tab opens on: Edit, as the mockup's state 2
 * shows it on an empty roll (the Song tab's default too).
 */
export const ROLL_ENVELOPE_TOOL_DEFAULT: AutomationTool = 'edit';

/** Each tool's hint under the tools, worded for the note pane (the mockup's). */
export const ROLL_ENVELOPE_HINTS: Readonly<Record<AutomationTool, string>> = {
  edit: 'Click to add a point · drag a point to move it · drag the line to bend it · Alt-click a line to straighten it · double-click a point to delete it · Shift ignores snap',
  draw: 'Drag across the pane to draw. Points land on the Snap grid; Off draws at 1/32.',
  shape:
    'Drag across the pane to select a range, then pick a shape. The dashed line previews it; Apply writes ordinary points you can edit afterwards.',
};

/** The picker's and the column's words. */
export const ROLL_ENVELOPE_TEXT = {
  envelope: 'Envelope',
  tool: 'Tool',
  pick: 'Pick target',
  pickTitle: 'The envelope shown: pick a voice target',
  listLabel: 'Envelope targets',
  marked: 'In this roll',
  shown: 'shown',
  off: 'off',
  lane: 'lane',
  envFull: "Four envelopes is a roll's most.",
  slotsFull:
    'Every voice slot is taken. A target with a song lane shares its slot; the rest wait for a free one.',
  envFullTitle: "Four envelopes is a roll's most",
  slotsFullTitle: 'Every voice slot is taken',
  onTitle: 'Switch this envelope on',
  offTitle: 'Switch this envelope off',
  deleteTitle: 'Delete this envelope',
} as const;

/** The counts: under the switch, two lines; in the list's head, two cells. */
export const envCountText = (count: number, max: number): string => `Env ${count}/${max}`;
export const voiceCountText = (used: number, max: number): string => `Voice ${used}/${max}`;
export const slotCountText = (used: number, max: number): string => `Voice slots ${used}/${max}`;

/** The undo steps the column writes (the issue's decision 7). */
export const ROLL_ENVELOPE_UNDO = {
  add: (name: string): string => `Add ${name} envelope`,
  on: (name: string, on: boolean): string => `Switch ${on ? 'on' : 'off'} ${name} envelope`,
  remove: (name: string): string => `Delete ${name} envelope`,
} as const;

/** The overlay's look: the curve's inset at top and bottom, and the scale's labels and their inset. */
export const ROLL_ENVELOPE_DRAW = {
  /** As the Song tab's lanes (`AUTOMATION_DRAWING.padPx`), so a value draws where a lane's would. */
  padPx: 6,
  scaleInsetPx: 4,
  /** The +1 label's baseline below the top inset, and the others' lift off their line. */
  scaleTopPx: 7,
  scaleLiftPx: 3,
  scale: { top: '+1', zero: '0', bottom: '−1' },
} as const;

/** The picker's list: its width, its tallest, and its gap from the button and the window's edge. */
export const ROLL_ENVELOPE_LIST_PX = { width: 214, maxHeight: 300, gap: 4, edge: 8 } as const;

/**
 * How an envelope's offset reads (windsor#708 decision 4): two decimals, one
 * once the offset reaches `wideFrom` in its units (a pitch envelope's
 * semitones), and a ratio row's unit.
 */
export const ROLL_ENVELOPE_READOUT = {
  decimals: 2,
  wideDecimals: 1,
  wideFrom: 10,
  octaves: 'oct',
} as const;

/** The drag readout's place: its lift above the point it reads, and the least gap from the pane's top. */
export const ROLL_ENVELOPE_READOUT_PX = { liftPx: 30, topPx: 2 } as const;

/**
 * The undo steps the tools write (windsor#708 decision 7). Move, Bend, Add,
 * Straighten and Delete keep the Song tab's words ("Move Cutoff point");
 * Draw and Shape name the envelope.
 */
export const ROLL_ENVELOPE_TOOL_UNDO = {
  draw: (name: string): string => `Draw ${name} envelope`,
  shape: (name: string): string => `Shape ${name} envelope`,
} as const;
