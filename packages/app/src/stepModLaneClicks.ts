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

/** What a release wrote: a double-click's reset to 0, which the card redraws, or anything else. */
export type ReleaseKind = 'reset' | 'values';

interface HeldClick {
  readonly lane: StepModParam;
  readonly index: number;
  readonly values: readonly number[];
  readonly at: number;
  readonly cancel: () => void;
}

/**
 * The lane cells' press, release and double-click rules, without the DOM.
 * A drag writes on release. A click (no travel past the slop) shows at once
 * but is held, and written when the double-click window closes. A second
 * press on the same cell inside the window paints like any press and is
 * decided at its release: still, it is a double-click, and the held click
 * gives way to the cell's reset to 0; dragged, it gives way to the dragged
 * values. Either way the pair writes one list. A press anywhere else writes
 * a held click first, and so must every other edit the card makes to its
 * steps or lanes (`flush`), or the held snapshot would later undo that edit.
 * A lane is named by its parameter, never its place in the list, and
 * removing a lane drops its held click (`cancel`). The browser's `dblclick`
 * is not used: by the time it fires, both presses are over.
 */
export class LaneClickGate {
  /** A click waiting out the window. */
  private held: HeldClick | null = null;
  /** A held click whose cell has been pressed again: that press's release decides. */
  private second: HeldClick | null = null;

  constructor(
    private readonly write: LaneWrite,
    private readonly clock: LaneClock,
    private readonly windowMs = LANE_DOUBLE_CLICK_MS,
  ) {}

  /** A press on `lane`'s cell `index`; the card paints from it, whatever it turns out to be. */
  press(lane: StepModParam, index: number): void {
    const held = this.held;
    if (
      held?.lane === lane &&
      held.index === index &&
      this.clock.now() - held.at <= this.windowMs
    ) {
      this.drop();
      this.second = held;
      return;
    }
    this.flush();
  }

  /**
   * A release. The second press of a pair writes the cell's reset (still) or
   * its values (dragged), in place of the held click; any other drag writes
   * now, and any other click is held.
   */
  release(
    lane: StepModParam,
    index: number,
    values: readonly number[],
    dragged: boolean,
  ): ReleaseKind {
    const second = this.second;
    this.second = null;
    if (second && !dragged) {
      this.write(lane, resetCell(second.values, index));
      return 'reset';
    }
    if (second || dragged) {
      this.write(lane, values);
      return 'values';
    }
    const cancel = this.clock.after(this.windowMs, () => this.flush());
    this.held = { lane, index, values: [...values], at: this.clock.now(), cancel };
    return 'values';
  }

  /** Drop a held click on `lane` unwritten: the lane is being removed. */
  cancel(lane: StepModParam): void {
    if (this.held?.lane === lane) this.drop();
    if (this.second?.lane === lane) this.second = null;
  }

  /**
   * Write a held click now: its window closed, another cell was pressed, the
   * second press was cancelled before its release, or the card is about to
   * edit the steps or lanes.
   */
  flush(): void {
    const waiting = this.held ?? this.second;
    if (!waiting) return;
    this.drop();
    this.second = null;
    this.write(waiting.lane, waiting.values);
  }

  private drop(): void {
    this.held?.cancel();
    this.held = null;
  }
}
