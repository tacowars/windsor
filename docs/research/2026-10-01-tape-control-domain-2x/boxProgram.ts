/** windsor#295: windsor#290's program, unchanged, scheduled in a box with a raised width
 * minimum. Every trial renders through that record's `runTrial` with its own box; only the
 * schedule (which boxes, which edge trials) is new here.
 */
import {
  boxTrials,
  type Box,
  type Trial,
} from '../2026-10-01-tape-control-domain/program';
import { BOX, type BoxTable } from './boxConstants';

export * from '../2026-10-01-tape-control-domain/program';
export { BOX };

/** A trial with the box its sweeps and walks move in, and the set it belongs to. */
export interface BoxTrial extends Trial {
  set: string;
  box: Box;
}

/** drive [0, 1] x width [wMin, wMax] x saturation [0, 1]. */
export const raisedBox = (wMin: number, table: BoxTable = BOX): Box => [
  [0, 1],
  [wMin, table.wMax],
  [0, 1],
];

const tagged = (set: string, box: Box, trial: Trial): BoxTrial => ({
  ...trial,
  id: `${set}/${trial.id}`,
  set,
  box,
});

/** windsor#290's whole part B (277 static points, 24 sweeps, 12 walks per rate and
 * factor), re-seeded into the raised box. */
export function ladderTrials(wMin: number, table: BoxTable = BOX): BoxTrial[] {
  const box = raisedBox(wMin, table);
  return boxTrials(box).map((t) => tagged(`box/${wMin}`, box, t));
}

/** On the line width = the box's minimum, saturation 0: the static points there and the
 * drive sweeps whose other two controls sit there. */
function onEdge(trial: Trial, box: Box) {
  const { path } = trial;
  if (path.kind === 'static') return path.point[1] === box[1][0] && path.point[2] === box[2][0];
  return path.kind === 'sweep' && path.axis === 0 && path.others.every((u) => u === 0);
}

/** The failing region's edge: the edge trials at each width, at the edge's factor. */
export function edgeTrials(table: BoxTable = BOX): BoxTrial[] {
  return table.edge.widths.flatMap((width) => {
    const box = raisedBox(width, table);
    return boxTrials(box)
      .filter((t) => t.factor === table.edge.factor && onEdge(t, box))
      .map((t) => tagged(`edge/${width}`, box, t));
  });
}
