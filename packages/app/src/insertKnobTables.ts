/**
 * The insert cards' knobs (#641), as data. Ranges are the engine's
 * (`inserts/insertConstants.ts`) and each default is the kind's own
 * (`DEFAULT_DRIVE`, `DEFAULT_CHORUS`), so the console states neither again.
 */
import type {
  BloomSpec,
  ChorusSpec,
  DriveSpec,
  EchoSpec,
  EnsembleSpec,
  FilterSpec,
  InsertKindName,
  PlateReverbSpec,
} from '@windsor/engine';
import {
  BLOOM_BOUNDS,
  BLOOM_OCTAVES,
  BLOOM_SCALE_DEFAULT,
  BLOOM_SHAPES,
  CHORUS_DEPTH_MAX_MS,
  CHORUS_DEPTH_MIN_MS,
  CHORUS_RATE_MAX_HZ,
  CHORUS_RATE_MIN_HZ,
  DEFAULT_BLOOM,
  DEFAULT_CHORUS,
  DEFAULT_DRIVE,
  DEFAULT_ECHO,
  DEFAULT_ENSEMBLE,
  DEFAULT_FILTER,
  DEFAULT_PLATE_REVERB,
  DRIVE_GAIN_MAX_DB,
  DRIVE_GAIN_MIN_DB,
  DRIVE_TONE_MAX_HZ,
  DRIVE_TONE_MIN_HZ,
  ENSEMBLE_BOUNDS,
  FILTER_BOUNDS,
  INSERT_AUTOMATION_FIELDS,
  REVERB_SPACE_RANGES,
} from '@windsor/engine';
import { fmt2, fmtDb, fmtHz, fmtMs, noteName } from './consoleFormat';
import type { KnobSpec } from './knob';
import { knobRangeOf } from './patchKnobRange';
import { DELAY_LINE_KNOBS, SPACE_KNOBS } from './returnControls';
import type { SeqKnobOpts } from './sequencerKnobTables';
import { KEY_OPTIONS } from './transportTables';

/** What each kind is called on its card and in the Add picker. */
export const INSERT_LABELS: Readonly<Record<InsertKindName, string>> = {
  drive: 'Classic Drive',
  'advanced-drive': 'Advanced Drive',
  chorus: 'Chorus',
  compressor: 'Bus compressor',
  'retro-reverb': 'Retro reverb',
  phaser: 'Phaser',
  tape: 'Tape',
  delay: 'Dub delay',
  ensemble: 'Ensemble',
  plate: 'Plate reverb',
  echo: 'Echo',
  eq: 'Parametric EQ',
  filter: 'Filter',
  bloom: 'Bloom',
};

/**
 * The Add slot's groups (windsor#173 decision 7), each an `<optgroup>` in
 * this order. Every kind is in exactly one; `insertCards.test.ts` fails on a
 * kind in none.
 */
export const INSERT_GROUPS: readonly {
  readonly label: string;
  readonly kinds: readonly InsertKindName[];
}[] = [
  { label: 'EQ', kinds: ['eq'] },
  { label: 'Filter', kinds: ['filter'] },
  { label: 'Drive', kinds: ['drive', 'advanced-drive', 'tape'] },
  { label: 'Dynamics', kinds: ['compressor'] },
  { label: 'Modulation', kinds: ['chorus', 'ensemble', 'phaser'] },
  { label: 'Time', kinds: ['echo', 'delay'] },
  { label: 'Space', kinds: ['plate', 'retro-reverb'] },
  // Bloom adds a layer rather than processing the sound (windsor#711).
  { label: 'Generate', kinds: ['bloom'] },
];

export interface InsertKnobEntry<S> {
  readonly f: Exclude<keyof S, 'kind'> & string;
  readonly label: string;
  readonly o: SeqKnobOpts & Pick<KnobSpec, 'logFloor' | 'steps'>;
  /** Where a turn to `v` stops, given the insert as it stands: Bloom's Low and High never cross. */
  readonly limit?: (v: number, spec: S) => number;
}

export const DRIVE_KNOBS: readonly InsertKnobEntry<DriveSpec>[] = [
  {
    f: 'drive',
    label: 'Drive',
    o: { min: DRIVE_GAIN_MIN_DB, max: DRIVE_GAIN_MAX_DB, def: DEFAULT_DRIVE.drive, fmt: fmtDb },
  },
  {
    f: 'tone',
    label: 'Tone',
    o: {
      min: DRIVE_TONE_MIN_HZ,
      max: DRIVE_TONE_MAX_HZ,
      def: DEFAULT_DRIVE.tone,
      curve: 'log',
      fmt: fmtHz,
    },
  },
  { f: 'mix', label: 'Mix', o: { min: 0, max: 1, def: DEFAULT_DRIVE.mix, fmt: fmt2 } },
];

export const CHORUS_KNOBS: readonly InsertKnobEntry<ChorusSpec>[] = [
  {
    f: 'rate',
    label: 'Rate',
    o: {
      min: CHORUS_RATE_MIN_HZ,
      max: CHORUS_RATE_MAX_HZ,
      def: DEFAULT_CHORUS.rate,
      curve: 'log',
      fmt: fmt2,
    },
  },
  {
    f: 'depth',
    label: 'Depth',
    o: { min: CHORUS_DEPTH_MIN_MS, max: CHORUS_DEPTH_MAX_MS, def: DEFAULT_CHORUS.depth, fmt: fmt2 },
  },
  { f: 'spread', label: 'Spread', o: { min: 0, max: 1, def: DEFAULT_CHORUS.spread, fmt: fmt2 } },
  { f: 'mix', label: 'Mix', o: { min: 0, max: 1, def: DEFAULT_CHORUS.mix, fmt: fmt2 } },
];

const ENSEMBLE_FIELDS = [
  ['slowRate', 'Slow rate'],
  ['slowDepth', 'Slow depth (ms)'],
  ['fastRate', 'Fast rate'],
  ['fastDepth', 'Fast depth (ms)'],
  ['delay', 'Delay (ms)'],
  ['tone', 'Tone'],
  ['width', 'Width'],
  ['mix', 'Mix'],
] as const;
const ENSEMBLE_LOG_FIELDS: ReadonlySet<string> = new Set(['slowRate', 'fastRate', 'tone']);

export const ENSEMBLE_KNOBS: readonly InsertKnobEntry<EnsembleSpec>[] = ENSEMBLE_FIELDS.map(
  ([f, label]) => ({
    f,
    label,
    o: {
      min: ENSEMBLE_BOUNDS[f][0],
      max: ENSEMBLE_BOUNDS[f][1],
      def: DEFAULT_ENSEMBLE[f],
      fmt: f === 'tone' ? fmtHz : fmt2,
      ...(ENSEMBLE_LOG_FIELDS.has(f) ? { curve: 'log' as const } : {}),
    },
  }),
);

/** The Plate reverb's knobs (windsor#171): the return's 15 space knobs, then Mix. */
export const PLATE_REVERB_KNOBS: readonly InsertKnobEntry<PlateReverbSpec>[] = [
  ...SPACE_KNOBS.map(({ f, label, o }) => ({
    f,
    label,
    o: {
      ...o,
      min: REVERB_SPACE_RANGES[f][0],
      max: REVERB_SPACE_RANGES[f][1],
      def: DEFAULT_PLATE_REVERB[f],
    },
  })),
  { f: 'mix', label: 'Mix', o: { min: 0, max: 1, def: DEFAULT_PLATE_REVERB.mix, fmt: fmt2 } },
];

/** The Echo's knobs (windsor#171): the return's Time, Regen, Damp and Q, then Mix. */
export const ECHO_KNOBS: readonly InsertKnobEntry<EchoSpec>[] = [
  ...DELAY_LINE_KNOBS.map(({ f, label, o }) => ({ f, label, o: { ...o, def: DEFAULT_ECHO[f] } })),
  { f: 'mix', label: 'Mix', o: { min: 0, max: 1, def: DEFAULT_ECHO.mix, fmt: fmt2 } },
];

/** The Filter's knobs (windsor#622): the voice filter's Cutoff and Reso, on its own ranges and log sweeps (windsor#626), then Mix. */
export const FILTER_INSERT_KNOBS: readonly InsertKnobEntry<FilterSpec>[] = [
  {
    f: 'cutoff',
    label: 'Cutoff',
    o: {
      min: FILTER_BOUNDS.cutoff[0],
      max: FILTER_BOUNDS.cutoff[1],
      def: DEFAULT_FILTER.cutoff,
      curve: 'log',
      fmt: fmtHz,
    },
  },
  {
    f: 'resonance',
    label: 'Reso',
    o: {
      min: FILTER_BOUNDS.resonance[0],
      max: FILTER_BOUNDS.resonance[1],
      def: DEFAULT_FILTER.resonance,
      curve: 'log',
      fmt: fmt2,
    },
  },
  { f: 'mix', label: 'Mix', o: { min: 0, max: 1, def: DEFAULT_FILTER.mix, fmt: fmt2 } },
];

/** Bloom's Shape readout: how far between two corners rounds to one of them. */
const SHAPE_ROUNDING = 100;
/** Bloom's Density readout: a ratio from here up reads whole, `12:1`. */
const DENSITY_WHOLE_FROM = 10;

/**
 * Bloom's Shape (windsor#712): the corner's name on an integer, and between
 * two the pair it sweeps across, `saw→square`. A fraction that rounds to a
 * corner reads as that corner, as the Formant vowel does.
 */
export function fmtBloomShape(v: number): string {
  const last = BLOOM_SHAPES.length - 1;
  const clamped = Math.min(Math.max(v, 0), last);
  const lower = Math.min(Math.floor(clamped), last - 1);
  const along = Math.round((clamped - lower) * SHAPE_ROUNDING);
  if (along === 0) return BLOOM_SHAPES[lower]!;
  if (along === SHAPE_ROUNDING) return BLOOM_SHAPES[lower + 1]!;
  return `${BLOOM_SHAPES[lower]}→${BLOOM_SHAPES[lower + 1]}`;
}

/**
 * Bloom's Density as the shared compressor's ratio, 1/(1 − Density): one
 * place under 10 (`1.8:1` at the default), whole from 10 (`12:1`), `∞:1` at 1.
 */
export function fmtBloomDensity(v: number): string {
  if (v >= 1) return '∞:1';
  const ratio = 1 / (1 - v);
  return `${ratio < DENSITY_WHOLE_FROM ? ratio.toFixed(1) : ratio.toFixed(0)}:1`;
}

/** Bloom's Bright, a tilt in dB per octave: `+0.0dB/oct`. */
const fmtBright = (v: number): string => `${fmtDb(v)}/oct`;

/** Bloom's Focus, a factor on every band's width. */
const fmtFocus = (v: number): string => `×${v.toFixed(2)}`;

/** Bloom's Octave step in semitones, signed: `-12st`, `0st`, `+7st`. */
export const fmtBloomOctave = (v: number): string => `${v > 0 ? '+' : ''}${v}st`;

/**
 * Bloom's Key picker (windsor#728): the transport's Key names, which are the
 * spelling Bloom stores (`C` … `B`), so each is its own value.
 */
export const BLOOM_KEY_ITEMS: readonly (readonly [string, string])[] = KEY_OPTIONS.map(
  ({ label }) => [label, label] as const,
);

/**
 * Bloom's Scale picker: `chromatic`, Bloom's off, alone and first; the
 * transport's scale groups (`SCALE_OPTION_GROUPS`) follow under their
 * `<optgroup>`s, with the transport's names.
 */
export const BLOOM_SCALE_OFF_ITEMS: readonly (readonly [string, string])[] = [
  [BLOOM_SCALE_DEFAULT, BLOOM_SCALE_DEFAULT],
];

/**
 * Low and High never cross (the approved mockup, windsor#711): a turn past
 * the other end stops at it.
 */
export function bloomBandLimit(field: 'low' | 'high', v: number, spec: BloomSpec): number {
  return field === 'low' ? Math.min(v, spec.high) : Math.max(v, spec.low);
}

/**
 * A Bloom knob's range: a lane's field takes its bounds, scale and floor from
 * its automation row (`knobRangeOf`), so the knob and the lane that locks it
 * agree; Low, High and Octave, no lane's, step a whole semitone over their
 * bounds, and Octave only onto `BLOOM_OCTAVES`.
 */
function bloomRange(field: keyof typeof BLOOM_BOUNDS): InsertKnobEntry<BloomSpec>['o'] {
  const row = INSERT_AUTOMATION_FIELDS.bloom.find((r) => r.target === field);
  const [min, max] = BLOOM_BOUNDS[field];
  const range = row ? knobRangeOf(row) : { min, max, step: 1 };
  const steps = field === 'octave' ? { steps: BLOOM_OCTAVES } : {};
  return { ...range, ...steps, def: DEFAULT_BLOOM[field] };
}

/** One Bloom knob: its field, label and readout over `bloomRange`, and its `limit` if it has one. */
const bloomKnob = (
  f: keyof typeof BLOOM_BOUNDS,
  label: string,
  fmt: (v: number) => string,
  limit?: InsertKnobEntry<BloomSpec>['limit'],
): InsertKnobEntry<BloomSpec> => ({
  f,
  label,
  o: { ...bloomRange(f), fmt },
  ...(limit ? { limit } : {}),
});

/**
 * Bloom's knobs (windsor#712), in the approved mockup's groups (windsor#711):
 * Envelope, Generator, Bands, Dynamics, Output. Key and Scale are pickers
 * and Freeze a latching button, on the card (`bloomCard.ts`).
 */
export const BLOOM_KNOBS: readonly InsertKnobEntry<BloomSpec>[] = [
  bloomKnob('swell', 'Swell', fmtMs),
  bloomKnob('sustain', 'Sustain', fmtMs),
  bloomKnob('shape', 'Shape', fmtBloomShape),
  bloomKnob('bright', 'Bright', fmtBright),
  bloomKnob('octave', 'Octave', fmtBloomOctave),
  bloomKnob('low', 'Low', noteName, (v, spec) => bloomBandLimit('low', v, spec)),
  bloomKnob('high', 'High', noteName, (v, spec) => bloomBandLimit('high', v, spec)),
  bloomKnob('focus', 'Focus', fmtFocus),
  bloomKnob('density', 'Density', fmtBloomDensity),
  bloomKnob('amount', 'Amount', fmt2),
  bloomKnob('spread', 'Spread', fmt2),
  bloomKnob('mix', 'Mix', fmt2),
];
