/** Tape knob bounds/defaults are the engine's song contract. */
import { DEFAULT_TAPE, TAPE_BOUNDS, type TapeSpec } from '@windsor/engine';
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
