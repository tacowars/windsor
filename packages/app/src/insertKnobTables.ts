/**
 * The insert cards' knobs (#641), as data. Ranges are the engine's
 * (`inserts/insertConstants.ts`) and each default is the kind's own
 * (`DEFAULT_DRIVE`, `DEFAULT_CHORUS`), so the console states neither again.
 */
import type { ChorusSpec, DriveSpec, EnsembleSpec, InsertKindName } from '@windsor/engine';
import {
  CHORUS_DEPTH_MAX_MS,
  CHORUS_DEPTH_MIN_MS,
  CHORUS_RATE_MAX_HZ,
  CHORUS_RATE_MIN_HZ,
  DEFAULT_CHORUS,
  DEFAULT_DRIVE,
  DEFAULT_ENSEMBLE,
  DRIVE_GAIN_MAX_DB,
  DRIVE_GAIN_MIN_DB,
  DRIVE_TONE_MAX_HZ,
  DRIVE_TONE_MIN_HZ,
  ENSEMBLE_BOUNDS,
} from '@windsor/engine';
import { fmt2, fmtDb, fmtHz } from './consoleFormat';
import type { SeqKnobOpts } from './sequencerKnobTables';

/** What each kind is called on its card and in the Add picker. */
export const INSERT_LABELS: Readonly<Record<InsertKindName, string>> = {
  drive: 'Classic Drive',
  'advanced-drive': 'Advanced Drive',
  chorus: 'Chorus',
  compressor: 'Bus compressor',
  'retro-reverb': 'Retro reverb',
  phaser: 'Phaser',
  delay: 'Dub delay',
  ensemble: 'Ensemble',
};

export interface InsertKnobEntry<S> {
  readonly f: Exclude<keyof S, 'kind'> & string;
  readonly label: string;
  readonly o: SeqKnobOpts;
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
