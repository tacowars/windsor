/** Phaser ranges and reset values come from the engine's song contract. */
import { DEFAULT_PHASER, PHASER_BOUNDS } from '@windsor/engine';
import type { PhaserSpec } from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';
import { fmt2, fmtHz } from './consoleFormat';

const fields = [
  ['rate', 'Rate'],
  ['center', 'Center'],
  ['depth', 'Depth (oct)'],
  ['feedback', 'Feedback'],
  ['feedbackCut', 'FB bass cut'],
  ['stereo', 'Stereo (°)'],
  ['envelope', 'Envelope (oct)'],
  ['bassKeep', 'Bass keep'],
  ['mix', 'Mix'],
] as const;
export const PHASER_KNOBS: readonly InsertKnobEntry<PhaserSpec>[] = fields.map(([f, label]) => ({
  f,
  label,
  o: {
    min: PHASER_BOUNDS[f][0],
    max: PHASER_BOUNDS[f][1],
    def: DEFAULT_PHASER[f],
    fmt: f === 'center' || f === 'feedbackCut' ? fmtHz : fmt2,
    ...(f === 'center' || f === 'feedbackCut' || f === 'rate' ? { curve: 'log' as const } : {}),
  },
}));
