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
 *   it keeps answering for earlier bars, even across edits in consecutive
 *   bars, so a playhead behind the scheduler lights what was heard. Only a region entry restarts (`restart`).
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

/** The index of the epoch in force at local `bar`: the last from on or before it, else the first. */
function epochIndexAt(epochs: readonly Epoch[], bar: number): number {
  let index = epochs.length - 1;
  while (index > 0 && (epochs[index]?.fromBar ?? 0) > bar) index -= 1;
  return index;
}

export class FigureLine {
  /**
   * The epochs in force from the entry on, by `fromBar`. An edit is made at
   * the bar after the scheduler's, and the audible clock lags the scheduler
   * by less than a bar, so no playhead reads a bar before the edit's two
   * back: the epochs ending before it are dropped, and the rest kept, so
   * edits in consecutive bars leave the heard bar its own process.
   */
  private epochs: readonly Epoch[];

  constructor(processes: FigureProcesses) {
    this.epochs = [entry(processes)];
  }

  /** A region entry: both counters start at 0 under `processes`. */
  restart(processes: FigureProcesses): void {
    this.epochs = [entry(processes)];
  }

  /** Take `processes` from local bar `fromBar` on, the counter carried; nothing when they are unchanged. */
  edit(processes: FigureProcesses, fromBar: number): void {
    const last = this.epochs[this.epochs.length - 1];
    if (last && sig(last) === sig(processes)) return;
    const kept = this.epochs.filter((epoch) => epoch.fromBar < fromBar);
    const before = kept[kept.length - 1];
    if (!before) {
      this.restart(processes);
      return;
    }
    const { schedule, drift } = processes;
    const heard = kept.slice(epochIndexAt(kept, fromBar - 2));
    this.epochs = [...heard, { schedule, drift, fromBar, rotation: rotationAt(before, fromBar) }];
  }

  /** The written cell local `step`, in local `bar`, sounds. */
  cellAt(step: number, bar: number, frame: FigureFrame): number {
    const epoch = this.epochs[epochIndexAt(this.epochs, bar)] ?? entry({});
    const stage = stageAt(epoch.schedule, bar);
    const length = Math.min(stage?.length ?? frame.length, frame.cells);
    const start = stage ? Math.ceil((stage.startBar * frame.barTicks) / frame.divisor) : 0;
    return mod(step - start + rotationAt(epoch, bar), length);
  }
}
