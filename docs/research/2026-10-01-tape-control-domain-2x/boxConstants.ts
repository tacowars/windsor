/** windsor#295: the declared experiment that qualifies a Tape knob box with a raised width
 * minimum at 2x and 4x. Everything else (the field program, the static points, sweeps and
 * walks, the pass criteria) is windsor#290's `CONTROL`, unchanged. Research only: nothing
 * from the GPL research core is reachable from here.
 */
export const BOX = {
  /** windsor#290's width maximum, set by its susceptibility rule at drive 0. Not re-derived. */
  wMax: 0.62,
  /** The width minima, run in order; the run stops at the first box that survives whole. */
  ladder: [0.05, 0.1, 0.15],
  /** The lowest width a shipped model row uses (Chrome). A minimum above it is flagged. */
  shippedMinimum: 0.13,
  /**
   * The failing region's edge: at each width, saturation at the box's low end (0), the
   * box's static points on that line (drive 0, 0.5 and 1) and its drive sweeps (50 ms and
   * 1 s), at `factor` and every rate.
   */
  edge: { widths: [0, 0.01, 0.02, 0.05], factor: 2 },
  /** Worker processes (half the machine's 8 cores) and the hard wall-clock bound, from the
   * start, over the edge and every box run. */
  workers: 4,
  budgetMs: 3600000,
  /** `--check` re-renders these trials and compares their records exactly. */
  spotChecks: [
    'edge/0/sweep/drive/-:0:0/1/48000/2',
    'box/0.05/sweep/drive/-:0.05:0/1/44100/2',
    'box/0.05/walk/jump-50ms/2901/96000/4',
  ],
};
export type BoxTable = typeof BOX;
