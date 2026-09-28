/**
 * The clock times the scheduler actually stamped on its recent ticks
 * (windsor#14). `audibleTick` reads these rather than re-deriving them from
 * the running tempo and swing. A live swing or tempo change then moves only
 * the ticks queued after it, and the playhead never runs backward while
 * the old queue drains.
 *
 * One preallocated ring, written once per tick: no allocation per tick.
 */
import { TICK_STAMP_RING } from './schedulerConstants';

export class TickStamps {
  private readonly times: Float64Array;
  /** The first tick of the current run: stamps before it are stale. */
  private from = 0;
  /** One past the last tick recorded. */
  private end = 0;

  constructor(size = TICK_STAMP_RING) {
    this.times = new Float64Array(size);
  }

  /** Forget every stamp: the next run starts at `tick`. */
  clear(tick: number): void {
    this.from = tick;
    this.end = tick;
  }

  /** Record that `tick` was stamped `time`. Ticks arrive in order. */
  record(tick: number, time: number): void {
    this.times[tick % this.times.length] = time;
    this.end = tick + 1;
  }

  /** The oldest tick whose stamp is still held. */
  get oldest(): number {
    return Math.max(this.from, this.end - this.times.length);
  }

  /**
   * The last recorded tick whose stamp is at or before `now + tolerance`, or
   * -1 when every held stamp is later than that (or none is held).
   */
  soundingAt(now: number, tolerance: number): number {
    const limit = now + tolerance;
    for (let tick = this.end - 1; tick >= this.oldest; tick--) {
      if (this.times[tick % this.times.length]! <= limit) return tick;
    }
    return -1;
  }
}
