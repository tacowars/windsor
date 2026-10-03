/**
 * Where a Figure's line is (windsor#486, record `2026-10-03-figure-sequencer`
 * decisions 4, 5 and 9): the written cell a local step sounds once the length
 * schedule and the rotation drift have had their say.
 *
 * - **The bar** is the region's local bar in the song's meter, counted from
 *   the region's entry: the gate's `bar` at an onset, the step's tick over
 *   the meter's bar length for a playhead.
 * - **The stage.** With a schedule, the stage is the entry whose cumulative
 *   `bars` hold the bar, cycling over the schedule's total; its `length`
 *   replaces the config's, and the line restarts at cell 0 on the stage's bar
 *   line (the first onset on or after it). Without one the region is one
 *   stage of the config's `length` from step 0, as windsor#485 played it.
 * - **The rotation** starts at 0 at the region's entry and adds `steps` at
 *   every `everyBars`-th bar line. The cell is `(stageStep + rotation) mod
 *   length`, a true modulo, so a backward drift never goes negative. The
 *   rotation applies to the stage's length, and a stage change keeps it.
 * - **A live edit** of the schedule or the drift takes effect at the next
 *   bar line: an epoch from that bar, with the rotation the counter holds
 *   there carried over, so an edit never resets a counter. The epoch before
 *   it keeps answering for earlier bars, so a playhead behind the scheduler
 *   lights what was heard. Only a region entry restarts (`restart`).
 *
 * Arithmetic over the step and the bar, with no history to replay: a seek, a
 * loop jump and a re-entry land on the right cell at once.
 */
import type { FigureDrift, FigureStage } from './figureSequencer';

/** The processes a line runs, each optional. */
export interface FigureProcesses {
  readonly schedule?: readonly FigureStage[] | undefined;
  readonly drift?: FigureDrift | undefined;
}

/** What a step resolves against: the cell count, the config's length, the divisor and the bar. */
export interface FigureFrame {
  readonly cells: number;
  readonly length: number;
  readonly divisor: number;
  readonly barTicks: number;
}

/** The processes in force from `fromBar` on, and the rotation the counter holds at that bar. */
interface Epoch extends FigureProcesses {
  readonly fromBar: number;
  readonly rotation: number;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

const sig = ({ schedule, drift }: FigureProcesses): string =>
  JSON.stringify([schedule?.length ? schedule : null, drift ?? null]);

/** The stage holding local `bar`: its length and its first bar; null without a schedule. */
export function stageAt(
  schedule: readonly FigureStage[] | undefined,
  bar: number,
): { length: number; startBar: number } | null {
  if (!schedule?.length) return null;
  const total = schedule.reduce((sum, stage) => sum + stage.bars, 0);
  let startBar = bar - mod(bar, total);
  for (const stage of schedule) {
    if (bar < startBar + stage.bars) return { length: stage.length, startBar };
    startBar += stage.bars;
  }
  return null;
}

/** The counter at local `bar` under `epoch`: its rotation plus `steps` per `everyBars`-th bar line since. */
function rotationAt(epoch: Epoch, bar: number): number {
  const { drift } = epoch;
  if (!drift) return epoch.rotation;
  const lines = Math.floor(bar / drift.everyBars) - Math.floor(epoch.fromBar / drift.everyBars);
  return epoch.rotation + drift.steps * lines;
}

const entry = ({ schedule, drift }: FigureProcesses): Epoch => ({
  schedule,
  drift,
  fromBar: 0,
  rotation: 0,
});

export class FigureLine {
  /** The epoch in force from the entry or before the last edit, then the last edit's. */
  private epochs: readonly [Epoch, Epoch?];

  constructor(processes: FigureProcesses) {
    this.epochs = [entry(processes)];
  }

  /** A region entry: both counters start at 0 under `processes`. */
  restart(processes: FigureProcesses): void {
    this.epochs = [entry(processes)];
  }

  /** Take `processes` from local bar `fromBar` on, the counter carried; nothing when they are unchanged. */
  edit(processes: FigureProcesses, fromBar: number): void {
    const [first, edited] = this.epochs;
    if (sig(edited ?? first) === sig(processes)) return;
    const before = edited && edited.fromBar < fromBar ? edited : first;
    if (before.fromBar >= fromBar) {
      this.restart(processes);
      return;
    }
    const { schedule, drift } = processes;
    this.epochs = [before, { schedule, drift, fromBar, rotation: rotationAt(before, fromBar) }];
  }

  /** The written cell local `step`, in local `bar`, sounds. */
  cellAt(step: number, bar: number, frame: FigureFrame): number {
    const [first, edited] = this.epochs;
    const epoch = edited && edited.fromBar <= bar ? edited : first;
    const stage = stageAt(epoch.schedule, bar);
    const length = Math.min(stage?.length ?? frame.length, frame.cells);
    const start = stage ? Math.ceil((stage.startBar * frame.barTicks) / frame.divisor) : 0;
    return mod(step - start + rotationAt(epoch, bar), length);
  }
}
