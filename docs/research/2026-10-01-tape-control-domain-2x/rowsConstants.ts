/** windsor#315: the declared experiment that qualifies a Tape knob box holding every shipped
 * model row, at 2x and 4x. Everything else (the field program, the static points, sweeps and
 * walks, the pass criteria) is windsor#290's `CONTROL`, unchanged, as windsor#295 ran it.
 * Research only: nothing from the GPL research core is reachable from here.
 */
export const ROWS = {
  /**
   * The candidate boxes, each drive [d, 1] x width [0.05, w] x saturation [0, 1], run in
   * order; the run stops at the first box in which every trial survives. The first is the
   * issue's box. Decision 3's steps: drive's minimum up to 0.1, width's maximum down to 0.83
   * (Vintage's row needs 0.831), then both.
   */
  candidates: [
    { drive: [0.05, 1], width: [0.05, 0.85] },
    { drive: [0.1, 1], width: [0.05, 0.85] },
    { drive: [0.05, 1], width: [0.05, 0.83] },
    { drive: [0.1, 1], width: [0.05, 0.83] },
  ],
  saturation: [0, 1],
  /**
   * The configure-only normalisation table: on each of a box's six faces, a grid of
   * (faceSteps + 1)^2 points; through its volume, a grid of (volumeSteps + 1)^3 points, to
   * show the extremes lie on the faces. Susceptibility against `margin` x the floor, as
   * windsor#290's rule (i); the gain against its width-0 value, as its rule (ii), reported.
   */
  faceSteps: 40,
  volumeSteps: 20,
  margin: 2,
  /** The motion gate (`rowsMotion.mjs`, the fix round on PR #317): how far past the box's
   * ends a glided control may read, for rounding only; a first-order glide never overshoots. */
  motion: { epsilon: 1e-12 },
  /** Worker processes (half the machine's 8 cores) and the hard wall-clock bound, from the
   * start, over every candidate run. */
  workers: 4,
  budgetMs: 3600000,
  /** `--check` re-renders these trials of the first candidate and compares them exactly. */
  spotChecks: [
    'rows/d0.05-w0.85/static/corner:0:1:0/48000/2',
    'rows/d0.05-w0.85/sweep/drive/-:0.85:0/1/44100/2',
    'rows/d0.05-w0.85/walk/jump-50ms/2902/96000/4',
  ],
};
export type RowsTable = typeof ROWS;
