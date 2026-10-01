/** windsor#315: windsor#290's program, unchanged, scheduled in the candidate boxes that hold
 * every shipped model row. Every trial renders through that record's `runTrial` with its own
 * box, as windsor#295's do; only the schedule and the shipped rows' table are new here.
 */
import { TAPE_LABELS, TAPE_MODELS } from '../../../packages/engine/src/inserts/tapeConstants';
import type { Triple } from '../2026-10-01-tape-control-domain/controlConstants';
import { boxTrials, type Box, type BoxTrial } from './boxProgram';
import { ROWS, type RowsTable } from './rowsConstants';

export * from './boxProgram';
export { ROWS };

export type Candidate = RowsTable['candidates'][number];

/** A candidate's name in trial ids: its drive minimum and width maximum. */
export const candidateName = (c: Candidate) => `d${c.drive[0]}-w${c.width[1]}`;

/** drive [d, 1] x width [wMin, wMax] x saturation [0, 1]. */
export const candidateBox = (c: Candidate, table: RowsTable = ROWS): Box => [
  [c.drive[0]!, c.drive[1]!],
  [c.width[0]!, c.width[1]!],
  [table.saturation[0]!, table.saturation[1]!],
];

/** windsor#290's whole part B (277 static points, 24 sweeps, 12 walks per rate and factor),
 * re-seeded into a candidate box. */
export function rowsTrials(c: Candidate, table: RowsTable = ROWS): BoxTrial[] {
  const box = candidateBox(c, table),
    set = `rows/${candidateName(c)}`;
  return boxTrials(box).map((t) => ({ ...t, id: `${set}/${t.id}`, set, box }));
}

/** The shipped model rows, by label. Read before any trial: `runTrial` appends its research
 * row to this bundle's `TAPE_MODELS`, which is not a shipped row. */
export function shippedRows(): { label: string; point: Triple }[] {
  return TAPE_LABELS.map((label, i) => ({
    label,
    point: [...TAPE_MODELS[i]!.magnetic] as Triple,
  }));
}
