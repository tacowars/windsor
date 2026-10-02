/**
 * The Song view's automation lanes, as data (windsor#348; record
 * `2026-10-01-song-automation-lanes` decision 13): the curve's drawing
 * tunables, the lane toolbar's tools and Snap choices and the gestures'
 * px (windsor#349, Shape from windsor#350), the colour of each kind of target, the picker's voice groups,
 * the readout's number rules and the reasons an insert field is inactive.
 * The rules over them are `songAutomationModel.ts`; the DOM is
 * `songAutomationLane.ts`. The lane's height is the Song view's
 * (`songViewTables.ts`'s `SONG_VIEW.automationLanePx`).
 */
import type {
  AutomationTargetKind,
  InsertKindName,
  InsertSpecOf,
  VoiceSection,
} from '@windsor/engine';
import { PPQ, TICKS_PER_BAR } from '@windsor/engine';

/** How a lane's curve is drawn inside its row. */
export interface AutomationDrawing {
  /** The space above the top of the range and below its bottom, so a point at either end shows whole. */
  readonly padPx: number;
  /** The px between two samples of a bent segment (decision 6). */
  readonly sampleEveryPx: number;
  /** A point's dot. */
  readonly dotRadiusPx: number;
  /** The decimals a coordinate is written with in the SVG path. */
  readonly coordDecimals: number;
}

export const AUTOMATION_DRAWING: AutomationDrawing = {
  padPx: 6,
  sampleEveryPx: 3,
  dotRadiusPx: 3.2,
  coordDecimals: 1,
};

/** The lane toolbar's tools (windsor#349 decision 1, and Shape from windsor#350 decision 1). */
export type AutomationTool = 'edit' | 'draw' | 'shape';

export interface AutomationToolEntry {
  readonly tool: AutomationTool;
  readonly label: string;
  /** The key that picks it while no field has focus (decision 6), as `KeyboardEvent.key`. */
  readonly key: string;
  /** What the tool does, under the toolbar's buttons. */
  readonly hint: string;
}

export const AUTOMATION_TOOLS: readonly AutomationToolEntry[] = [
  {
    tool: 'edit',
    label: 'Edit',
    key: 'e',
    hint: 'Click to add a point · drag a point to move it · drag the line to bend it · Alt-click a line to straighten it · double-click a point to delete it · Shift ignores snap',
  },
  {
    tool: 'draw',
    label: 'Draw',
    key: 'd',
    hint: 'Drag across a lane to draw. Points land on the snap grid; Off draws at 1/32.',
  },
  {
    tool: 'shape',
    label: 'Shape',
    key: 's',
    hint: 'Drag across a lane to select a range, then pick a shape. The dashed line previews it; Apply writes ordinary points you can edit afterwards.',
  },
];

/** One Snap choice: its label and its grain in song ticks, 0 for Off. */
export interface SnapChoice {
  readonly label: string;
  readonly ticks: number;
}

const SIXTEENTH_TICKS = PPQ / 4;
const THIRTY_SECOND_TICKS = PPQ / 8;

/** The Snap select (decision 1), coarse to fine. */
export const SNAP_CHOICES: readonly SnapChoice[] = [
  { label: 'Bar', ticks: TICKS_PER_BAR },
  { label: '1/4', ticks: PPQ },
  { label: '1/8', ticks: PPQ / 2 },
  { label: '1/16', ticks: SIXTEENTH_TICKS },
  { label: '1/32', ticks: THIRTY_SECOND_TICKS },
  { label: 'Off', ticks: 0 },
];

/** Where the session starts: the Edit tool, on 1/16. */
export const DEFAULT_AUTOMATION_TOOL: AutomationTool = 'edit';
export const DEFAULT_SNAP_TICKS = SIXTEENTH_TICKS;

/** How the Edit and Draw gestures read the pointer (decisions 2 and 3, from the mockup). */
export interface AutomationGestures {
  /** A press this close to a point's centre grabs the point. */
  readonly pointHitPx: number;
  /** A press this close to the line, above or below, is on the line. */
  readonly lineHitPx: number;
  /** A press that moves less than this is a click. */
  readonly dragThresholdPx: number;
  /** Vertical px of line drag for one full bend (−1..1 is two of them). */
  readonly bendPxPerUnit: number;
  /** A bend this close to 0 snaps straight. */
  readonly straightWithin: number;
  /** Draw's grain while Snap is Off. */
  readonly drawOffGrainTicks: number;
}

export const AUTOMATION_GESTURES: AutomationGestures = {
  pointHitPx: 8,
  lineHitPx: 10,
  dragThresholdPx: 3,
  bendPxPerUnit: 45,
  straightWithin: 0.07,
  drawOffGrainTicks: THIRTY_SECOND_TICKS,
};

/** How a split's right half is fitted (`songAutomationSplit.ts`). */
export interface AutomationSplitFit {
  /** The points along the half where the fit compares the curves. */
  readonly samples: number;
  /** The bends tried across −1..1 before refining. */
  readonly gridSteps: number;
  /** Golden-section steps around the best of them. */
  readonly refineIterations: number;
}

export const AUTOMATION_SPLIT_FIT: AutomationSplitFit = {
  samples: 16,
  gridSteps: 40,
  refineIterations: 30,
};

/** Each kind's colour (decision 3): the mixer teal, the inserts violet, the voice amber. */
export const LANE_KIND_COLOR: Readonly<Record<AutomationTargetKind, string>> = {
  strip: 'var(--modulator)',
  insert: 'var(--return)',
  voice: 'var(--carrier)',
};

/** The picker's group for the strip's targets, and the kind line under a strip lane's name. */
export const MIXER_GROUP_LABEL = 'Mixer';

/** The picker's group label for an insert, from the insert's label. */
export const insertGroupLabel = (insertLabel: string): string => `Insert · ${insertLabel}`;

/**
 * The voice's group labels in the picker (decision 4), by the catalog's
 * section (windsor#436); the groups come in the catalog's order. An
 * operator's group is this label and the operator's letter.
 */
export const VOICE_GROUPS: Readonly<Record<VoiceSection['kind'], string>> = {
  filter: 'Voice · Filter',
  operator: 'Voice · Op',
  lfo: 'Voice · LFO',
  pitch: 'Voice · Pitch',
};

/** A voice section's group label: `Voice · Filter`, `Voice · Op B`. */
export const voiceGroupLabel = (section: VoiceSection, opNames: readonly string[]): string =>
  section.kind === 'operator'
    ? `${VOICE_GROUPS.operator} ${opNames[section.op] ?? ''}`
    : VOICE_GROUPS[section.kind];

/** How a readout prints a number: the thresholds where it drops a decimal. */
export interface ReadoutNumbers {
  /** Hz and above print in kHz. */
  readonly kiloHz: number;
  /** Seconds under this print in ms. */
  readonly secondsAsMsBelow: number;
  /** A plain number at or past this many units prints with no decimals, and past `oneDecimalFrom` with one. */
  readonly wholeFrom: number;
  readonly oneDecimalFrom: number;
  /** Pan's −1..1 printed as L/R 0..100. */
  readonly panScale: number;
  readonly msPerSecond: number;
  /** Decibels per decade of linear gain: a level lane's value in dB. */
  readonly dbPerDecade: number;
}

export const READOUT_NUMBERS: ReadoutNumbers = {
  kiloHz: 1000,
  secondsAsMsBelow: 1,
  wholeFrom: 100,
  oneDecimalFrom: 10,
  panScale: 100,
  msPerSecond: 1000,
  dbPerDecade: 20,
};

/**
 * Why an insert field is inactive, as the clause after "while": one function
 * per kind whose rows carry `available` (`automationInsertTables.ts` in the
 * engine), over the insert's spec and the field. A kind or a field it does
 * not answer reads "under <insert>'s current settings".
 */
export type InactiveWhy = {
  readonly [K in InsertKindName]?: (spec: InsertSpecOf<K>, field: string) => string | undefined;
};

/** `stages.1.amount` → [1, 'amount']; `bands.0.q` → [0, 'q']. */
const indexed = (field: string): readonly [number, string] | undefined => {
  const match = /^[a-z]+\.(\d+)\.(.+)$/.exec(field);
  return match ? [Number(match[1]), match[2] ?? ''] : undefined;
};

const SHAPER_FIELDS: ReadonlySet<string> = new Set([
  'amount',
  'bias',
  'envAmount',
  'envBias',
  'lfoAmount',
  'lfoBias',
]);
const FILTER_FIELDS: ReadonlySet<string> = new Set([
  'frequency',
  'resonance',
  'envCutoff',
  'lfoCutoff',
]);

function driveStageWhy(spec: InsertSpecOf<'advanced-drive'>, field: string): string | undefined {
  const at = indexed(field);
  if (!at) return undefined;
  const [i, name] = at;
  const stage = spec.stages[i];
  const label = `stage ${i + 1}`;
  if (!stage?.enabled) return `${label} is off`;
  if (SHAPER_FIELDS.has(name) && !stage.shaping) return `${label} is not shaping`;
  if ((FILTER_FIELDS.has(name) || name === 'peak') && !stage.filtering) {
    return `${label} is not filtering`;
  }
  if (name === 'peak' && stage.filter !== 'peak') return `${label}'s filter is not a peak`;
  return `the ${spec.route} route does not play ${label}`;
}

function eqBandWhy(spec: InsertSpecOf<'eq'>, field: string): string | undefined {
  const at = indexed(field);
  if (!at) return undefined;
  const [i, name] = at;
  const label = `band ${i + 1}`;
  if (spec.bands[i]?.on !== true) return `${label} is off`;
  if (name === 'gain') return `${label} is a cut, which has no gain`;
  if (name === 'q') return `${label} is a 6 dB/oct cut, which has no Q`;
  return undefined;
}

export const INACTIVE_WHY: InactiveWhy = {
  tape: (_spec, field) =>
    field === 'wear' ? "Tape's motion is split" : "Tape's motion is not split",
  delay: (_spec, field) =>
    field === 'leftMs' ? 'the left side is synced' : 'the right side is synced',
  'retro-reverb': (_spec, field) =>
    field === 'duration' ? 'Retro reverb is in reverb mode' : 'Retro reverb is not in reverb mode',
  'advanced-drive': (spec, field) => {
    if (field === 'rate') return 'the LFO is synced';
    if (field === 'low' || field === 'high') return 'the route is not multiband';
    if (field === 'blend') return 'the route is neither serial nor parallel';
    return driveStageWhy(spec, field);
  },
  eq: eqBandWhy,
};
