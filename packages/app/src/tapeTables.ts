/** Tape knob bounds/defaults are the engine's song contract. */
import {
  DEFAULT_TAPE,
  TAPE_BOUNDS,
  TAPE_CORE_BOUNDS,
  TAPE_OVERSAMPLING,
  driveGain,
  type TapeCore,
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
 * The Advanced section's knobs (windsor#291 decision 2): the magnetic core's
 * three controls, in order, each over its `TAPE_CORE_BOUNDS`. The first is
 * Bend, never "Drive": the card's Drive is the gain into the tape.
 */
export const TAPE_CORE_KNOBS: readonly {
  readonly f: keyof TapeCore;
  readonly label: string;
  readonly title: string;
}[] = [
  { f: 'drive', label: 'Bend', title: 'How soon the tape bends into saturation' },
  { f: 'width', label: 'Width', title: 'How wide the hysteresis loop is' },
  { f: 'saturation', label: 'Saturation', title: 'How low the ceiling sits' },
];

/** The Advanced section's words (windsor#291 decision 2 and 3). */
export const TAPE_ADVANCED_TEXT = {
  header: 'Advanced',
  custom: 'Custom',
  useModel: 'Use model',
  useModelTitle: "Follow the tape type's own core again",
  openTitle: "Show the magnetic core's Bend, Width and Saturation",
  closeTitle: 'Hide the core controls',
} as const;

/** Percent of a knob's travel. */
const PERCENT = 100;

/**
 * A core knob's readout (windsor#291 decision 2): 0–100 % over its
 * `TAPE_CORE_BOUNDS`, whole percent. Every model row lies inside the box
 * (windsor#315), so a model's own controls read inside 0–100 % too.
 */
export function tapeCoreReadout(field: keyof TapeCore, v: number): string {
  const [min, max] = TAPE_CORE_BOUNDS[field];
  return `${Math.round((PERCENT * (v - min)) / (max - min))}%`;
}

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
 * then its knobs, two to a column, then the Advanced section where `advanced`
 * is set (windsor#291). A control added to Tape is placed by
 * adding it here; `tapeTables.test.ts` fails on a knob or a control on no
 * page, or on two.
 */
export const TAPE_PAGES: readonly {
  readonly name: string;
  readonly controls: readonly TapeControl[];
  readonly knobs: readonly TapeNumber[];
  readonly advanced?: true;
}[] = [
  {
    name: 'Tape',
    controls: ['model', 'oversampling', 'preset', 'randomize'],
    knobs: ['drive', 'bias', 'hiss', 'trim', 'mix'],
    advanced: true,
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
