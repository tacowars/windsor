/** Tape knob bounds/defaults are the engine's song contract. */
import { DEFAULT_TAPE, TAPE_BOUNDS, type TapeNumber, type TapeSpec } from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';
import { fmt2 } from './consoleFormat';
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
      if (f === 'hiss' && v <= TAPE_BOUNDS.hiss[0]) return 'Off';
      if (f === 'wowRate' || f === 'flutterRate') return `${fmt2(v)} Hz`;
      if (f === 'wow' || f === 'flutter' || f === 'dropouts') return `${fmt2(v)}%`;
      return fmt2(v);
    },
  },
}));

/** One of Tape's controls that is not a knob: the type and starting-point pickers, and Randomize. */
export type TapeControl = 'model' | 'preset' | 'randomize';

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
    controls: ['model', 'preset', 'randomize'],
    knobs: ['drive', 'bias', 'hiss', 'trim', 'mix'],
  },
  {
    name: 'Motion',
    controls: [],
    knobs: ['wow', 'wowRate', 'flutter', 'flutterRate', 'dropouts'],
  },
];

/** Every control `TAPE_PAGES` has to place. */
export const TAPE_CONTROLS: readonly TapeControl[] = ['model', 'preset', 'randomize'];
