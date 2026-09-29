/**
 * The lane cells' press, release and double-click timing (windsor#31),
 * without the DOM: when a lane edit is written, on a clock the card injects
 * (`performance.now` and `setTimeout` in the page, a fake in the tests).
 * The values themselves are `stepModLaneModel.ts`'s; `stepModLane.ts` feeds
 * this its pointer events.
 */
import type { StepModParam } from '@windsor/engine';
import { resetCell } from './stepModLaneModel';
import { LANE_CLICK_SLOP_PX, LANE_DOUBLE_CLICK_MS } from './stepModLaneTables';

/** Whether a press has travelled far enough from where it went down to be a drag. */
export function isDrag(dx: number, dy: number, slop = LANE_CLICK_SLOP_PX): boolean {
  return Math.abs(dx) > slop || Math.abs(dy) > slop;
}

/** The time and the timer a click gate runs on; a test passes a fake. */
export interface LaneClock {
  now(): number;
  /** Run `fn` after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

/** Where a lane edit lands: one lane's whole value list, the lane named by its parameter. */
export type LaneWrite = (lane: StepModParam, values: readonly number[]) => void;

/** What a press does: start painting, or reset the cell (the second press of a double-click). */
export type PressKind = 'paint' | 'reset';

interface PendingClick {
  readonly lane: StepModParam;
  readonly index: number;
  readonly values: readonly number[];
  readonly at: number;
  readonly cancel: () => void;
}

/**
 * The lane cells' press, release and double-click rules, without the DOM.
 * A drag writes on release. A click (no travel past the slop) shows at once
 * but is written only when the double-click window closes; a second press
 * on the same cell inside the window drops that write and writes the cell's
 * reset to 0 instead, so a double-click writes one list, with 0 at the
 * cell. A press anywhere else writes a waiting click first. A lane is
 * named by its parameter, never its place in the list, and removing a lane
 * drops its waiting click (`cancel`). The browser's
 * `dblclick` is not used: by the time it fires, both presses are over.
 */
export class LaneClickGate {
  private pending: PendingClick | null = null;
  private resetting = false;

  constructor(
    private readonly write: LaneWrite,
    private readonly clock: LaneClock,
    private readonly windowMs = LANE_DOUBLE_CLICK_MS,
  ) {}

  /** A press on `lane`'s cell `index`. On `reset` the gate has written the 0; the card only redraws. */
  press(lane: StepModParam, index: number): PressKind {
    const waiting = this.pending;
    if (
      waiting?.lane === lane &&
      waiting.index === index &&
      this.clock.now() - waiting.at <= this.windowMs
    ) {
      this.drop();
      this.resetting = true;
      this.write(lane, resetCell(waiting.values, index));
      return 'reset';
    }
    this.flush();
    this.resetting = false;
    return 'paint';
  }

  /** A release: a drag writes now, a click waits out the window, the release of a reset does nothing. */
  release(lane: StepModParam, index: number, values: readonly number[], dragged: boolean): void {
    if (this.resetting) {
      this.resetting = false;
      return;
    }
    if (dragged) return this.write(lane, values);
    const cancel = this.clock.after(this.windowMs, () => this.flush());
    this.pending = { lane, index, values: [...values], at: this.clock.now(), cancel };
  }

  /** Drop a waiting click on `lane` unwritten: the lane is being removed. */
  cancel(lane: StepModParam): void {
    if (this.pending?.lane === lane) this.drop();
  }

  /** Write a waiting click now. */
  flush(): void {
    const waiting = this.pending;
    if (!waiting) return;
    this.drop();
    this.write(waiting.lane, waiting.values);
  }

  private drop(): void {
    this.pending?.cancel();
    this.pending = null;
  }
}
