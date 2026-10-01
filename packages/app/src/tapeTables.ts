/** Tape knob bounds/defaults are the engine's song contract. */
import {
  DEFAULT_TAPE,
  TAPE_BOUNDS,
  TAPE_OVERSAMPLING,
  driveGain,
  type TapeNumber,
  type TapeSpec,
} from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';
import { fmt2 } from './consoleFormat';
/** Decibels per decade of amplitude, for the Drive readout. */
const DB_PER_DECADE = 20;

/**
 * The Drive readout (windsor#246 decision 3): the gain the magnetic core
 * receives, `driveGain(v)`, as signed dB to one decimal — `-12.0 dB`,
 * `0.0 dB`, `+12.0 dB` at the knob's minimum, centre and maximum. The knob
 * keeps its stored Drive value; only what it reads out changes.
 */
export function driveReadout(v: number): string {
  const text = (DB_PER_DECADE * Math.log10(driveGain(v))).toFixed(1);
  if (Number(text) === 0) return '0.0 dB';
  return `${text.startsWith('-') ? '' : '+'}${text} dB`;
}

const fields = [
  ['drive', 'Drive (dB)'],
  ['bias', 'Bias'],
  ['wow', 'Wow'],
  ['flutter', 'Flutter'],
  ['dropouts', 'Dropouts'],
  ['wowRate', 'Wow rate'],
  ['flutterRate', 'Flutter rate'],
  ['hiss', 'Hiss (dB)'],
  ['trim', 'Trim (dB)'],
  ['mix', 'Mix'],
] as const;
export const TAPE_KNOBS: readonly InsertKnobEntry<TapeSpec>[] = fields.map(([f, label]) => ({
  f,
  label,
  o: {
    min: TAPE_BOUNDS[f][0],
    max: TAPE_BOUNDS[f][1],
    def: DEFAULT_TAPE[f],
    fmt: (v: number): string => {
      if (f === 'drive') return driveReadout(v);
      if (f === 'hiss' && v <= TAPE_BOUNDS.hiss[0]) return 'Off';
      if (f === 'wowRate' || f === 'flutterRate') return `${fmt2(v)} Hz`;
      if (f === 'wow' || f === 'flutter' || f === 'dropouts') return `${fmt2(v)}%`;
      return fmt2(v);
    },
  },
}));

/**
 * One of Tape's controls that is not a knob: the type, oversampling and
 * starting-point pickers, and Randomize.
 */
export type TapeControl = 'model' | 'oversampling' | 'preset' | 'randomize';

/** The Oversampling picker's options, `TAPE_OVERSAMPLING` in order: value `'2'`, text `2×`. */
export const TAPE_OVERSAMPLING_OPTIONS: readonly (readonly [value: string, text: string])[] =
  TAPE_OVERSAMPLING.map((factor) => [String(factor), `${factor}×`] as const);

/** The Oversampling picker's hint (windsor#246 decision 2), word for word. */
export const TAPE_OVERSAMPLING_HINT =
  '2× is lighter on CPU; 4× is cleaner on bright, hard-driven sounds.';

/**
 * Tape's pages in the rack (windsor#175 decisions 1 and 3), in tab order:
 * each names its pickers and buttons, which stand first in a wide column,
 * then its knobs, two to a column. A control added to Tape is placed by
 * adding it here; `tapeTables.test.ts` fails on a knob or a control on no
 * page, or on two.
 */
export const TAPE_PAGES: readonly {
  readonly name: string;
  readonly controls: readonly TapeControl[];
  readonly knobs: readonly TapeNumber[];
}[] = [
  {
    name: 'Tape',
    controls: ['model', 'oversampling', 'preset', 'randomize'],
    knobs: ['drive', 'bias', 'hiss', 'trim', 'mix'],
  },
  {
    name: 'Motion',
    controls: [],
    knobs: ['wow', 'wowRate', 'flutter', 'flutterRate', 'dropouts'],
  },
];

/** Every control `TAPE_PAGES` has to place. */
export const TAPE_CONTROLS: readonly TapeControl[] = [
  'model',
  'oversampling',
  'preset',
  'randomize',
];
