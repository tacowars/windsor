/**
 * The lane cells' press, release and double-click rules (windsor#31),
 * without the DOM: what a release writes, on a clock the card injects
 * (`performance.now` in the page, a fake in the tests). The values
 * themselves are `stepModLaneModel.ts`'s; `stepModLane.ts` feeds this its
 * pointer events.
 */
import type { VoiceTargetPath } from '@windsor/engine';
import { resetCell } from './stepModLaneModel';
import { LANE_CLICK_SLOP_PX, LANE_DOUBLE_CLICK_MS } from './stepModLaneTables';

/** Whether a press has travelled far enough from where it went down to be a drag. */
export function isDrag(dx: number, dy: number, slop = LANE_CLICK_SLOP_PX): boolean {
  return Math.abs(dx) > slop || Math.abs(dy) > slop;
}

/** The time a click gate reads; a test passes a fake. */
export interface LaneClock {
  now(): number;
}

/** Where a lane edit lands: one lane's whole value list, the lane named by its parameter. */
export type LaneWrite = (lane: VoiceTargetPath, values: readonly number[]) => void;

/** What a release wrote: a double-click's reset to 0, which the card redraws, or anything else. */
export type ReleaseKind = 'reset' | 'values';

interface LastClick {
  readonly lane: VoiceTargetPath;
  readonly index: number;
  /** When the click was released. */
  readonly at: number;
}

/**
 * The lane cells' press, release and double-click rules, without the DOM.
 * Every release writes at once: a drag its values, a click (no travel past
 * the slop) its value. A second press on the same cell of the same lane
 * that starts within the window of the last click's release, and releases
 * without dragging, is a double-click: it writes the cell's reset to 0. If
 * it drags, it is an ordinary drag. A double-click forgets the click before
 * it, so a third click is a plain click.
 *
 * A double-click therefore writes twice, the click and then the reset.
 * That is fine: Windsor has no undo stack for the pair to clutter, and
 * during playback the click's value can sound for at most the window.
 * Nothing is ever held, so nothing can land after another edit or a
 * re-render. A lane is named by its parameter, never its place in the list.
 * The browser's `dblclick` is not used: by the time it fires, both presses
 * are over.
 */
export class LaneClickGate {
  /** The last plain click, the one a second press would pair with. */
  private last: LastClick | null = null;
  /** Whether the press in progress is the second of a pair. */
  private second = false;

  constructor(
    private readonly write: LaneWrite,
    private readonly clock: LaneClock,
    private readonly windowMs = LANE_DOUBLE_CLICK_MS,
  ) {}

  /** A press on `lane`'s cell `index`; the card paints from it, whatever it turns out to be. */
  press(lane: VoiceTargetPath, index: number): void {
    const last = this.last;
    this.second =
      last?.lane === lane && last.index === index && this.clock.now() - last.at <= this.windowMs;
  }

  /**
   * A release, written now: a still second press writes the cell's reset,
   * anything else its values.
   */
  release(
    lane: VoiceTargetPath,
    index: number,
    values: readonly number[],
    dragged: boolean,
  ): ReleaseKind {
    const second = this.second;
    this.second = false;
    this.last = null;
    if (dragged) {
      this.write(lane, values);
      return 'values';
    }
    if (second) {
      this.write(lane, resetCell(values, index));
      return 'reset';
    }
    this.write(lane, values);
    this.last = { lane, index, at: this.clock.now() };
    return 'values';
  }
}
