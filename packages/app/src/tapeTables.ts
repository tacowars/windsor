/** Tape knob bounds/defaults are the engine's song contract. */
import { DEFAULT_TAPE, TAPE_BOUNDS, type TapeSpec } from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';
import { fmt2 } from './consoleFormat';
const fields = [
  ['drive', 'Drive (dB)'],
  ['bias', 'Bias'],
  ['wear', 'Wear (%)'],
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
    fmt: f === 'hiss' ? (v: number): string => (v <= TAPE_BOUNDS.hiss[0] ? 'Off' : fmt2(v)) : fmt2,
  },
}));
