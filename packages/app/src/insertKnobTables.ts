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
  bloom: 'bloom',
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
  // bloom's group is settled with its card's mockup (windsor#711); Space stands in.
  { label: 'Space', kinds: ['plate', 'retro-reverb', 'bloom'] },
];

export interface InsertKnobEntry<S> {
  readonly f: Exclude<keyof S, 'kind'> & string;
  readonly label: string;
  readonly o: SeqKnobOpts & Pick<KnobSpec, 'logFloor'>;
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

/** The Plate reverb's knobs (windsor#171): the return's 13 space knobs, then Mix. */
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

const PERCENT = 100;
/** A 0..1 share as a whole percent. */
const fmtPercent = (v: number): string => `${Math.round(v * PERCENT)}%`;

/**
 * bloom's Shape (windsor#712): the corner's name on an integer, and between
 * two the pair it sweeps across with how far along, `saw→square 40%`, as the
 * Formant vowel reads.
 */
export function fmtBloomShape(v: number): string {
  const last = BLOOM_SHAPES.length - 1;
  const clamped = Math.min(Math.max(v, 0), last);
  const lower = Math.min(Math.floor(clamped), last - 1);
  const pct = Math.round((clamped - lower) * PERCENT);
  if (pct === 0) return BLOOM_SHAPES[lower]!;
  if (pct === PERCENT) return BLOOM_SHAPES[lower + 1]!;
  return `${BLOOM_SHAPES[lower]}→${BLOOM_SHAPES[lower + 1]} ${pct}%`;
}

/** bloom's Density as the shared compressor's ratio, 1/(1 − Density): `1.8:1` at the default. */
export const fmtBloomDensity = (v: number): string =>
  v >= 1 ? '∞:1' : `${(1 / (1 - v)).toFixed(1)}:1`;

/** bloom's Focus, a factor on every band's width. */
const fmtFocus = (v: number): string => `×${v.toFixed(2)}`;

/** bloom's Octave step in semitones, signed: `−12`, `0`, `+7`. */
export const fmtBloomOctave = (v: number): string =>
  v > 0 ? `+${v} st` : v < 0 ? `−${-v} st` : '0 st';

/** bloom's Scale choices as the card names them: `pentatonic-major` reads `Pentatonic major`. */
export const bloomScaleLabel = (scale: string): string =>
  scale.charAt(0).toUpperCase() + scale.slice(1).replace('-', ' ');

/**
 * A bloom knob's range: a lane's field takes its bounds, scale and floor from
 * its automation row (`knobRangeOf`), so the knob and the lane that locks it
 * agree; Low and High, no lane's, step a whole note over the band range.
 */
function bloomRange(field: keyof typeof BLOOM_BOUNDS): InsertKnobEntry<BloomSpec>['o'] {
  const row = INSERT_AUTOMATION_FIELDS.bloom.find((r) => r.target === field);
  const [min, max] = BLOOM_BOUNDS[field];
  return { ...(row ? knobRangeOf(row) : { min, max, step: 1 }), def: DEFAULT_BLOOM[field] };
}

/** One bloom knob: its field, label and readout over `bloomRange`. */
const bloomKnob = (
  f: keyof typeof BLOOM_BOUNDS,
  label: string,
  fmt: (v: number) => string,
): InsertKnobEntry<BloomSpec> => ({ f, label, o: { ...bloomRange(f), fmt } });

/**
 * bloom's knobs (windsor#712), in #711's groups: Envelope, Generator, Bands,
 * Dynamics, Output. Octave, Key and Scale are pickers and Freeze a switch,
 * on the card (`bloomCard.ts`).
 */
export const BLOOM_KNOBS: readonly InsertKnobEntry<BloomSpec>[] = [
  bloomKnob('swell', 'Swell', fmtMs),
  bloomKnob('sustain', 'Sustain', fmtMs),
  bloomKnob('shape', 'Shape', fmtBloomShape),
  bloomKnob('bright', 'Bright', fmtDb),
  bloomKnob('low', 'Low', noteName),
  bloomKnob('high', 'High', noteName),
  bloomKnob('focus', 'Focus', fmtFocus),
  bloomKnob('density', 'Density', fmtBloomDensity),
  bloomKnob('amount', 'Amount', fmtPercent),
  bloomKnob('spread', 'Spread', fmtPercent),
  bloomKnob('mix', 'Mix', fmtPercent),
];
