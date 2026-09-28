/**
 * The clock times the scheduler actually stamped on its recent ticks
 * (windsor#14). `audibleTick` reads these rather than re-deriving them from
 * the running tempo and swing. A live swing or tempo change then moves only
 * the ticks queued after it, and the playhead never runs backward while
 * the old queue drains.
 *
 * Stamps are held in issue order, each with its tick, because the tick is
 * not monotonic: a loop (windsor#15) jumps it back from the loop end to the
 * loop start. The times always are.
 *
 * One preallocated ring, written once per tick: no allocation per tick.
 */
import { TICK_STAMP_RING } from './schedulerConstants';

export class TickStamps {
  private readonly times: Float64Array;
  private readonly ticks: Float64Array;
  /** The first tick of the current run: what `oldest` reads before anything is recorded. */
  private from = 0;
  /** Stamps recorded since the last `clear`; the next one lands at `count % size`. */
  private count = 0;

  constructor(size = TICK_STAMP_RING) {
    this.times = new Float64Array(size);
    this.ticks = new Float64Array(size);
  }

  /** Forget every stamp: the next run starts at `tick`. */
  clear(tick: number): void {
    this.from = tick;
    this.count = 0;
  }

  /** Record that `tick` was stamped `time`. Times arrive in order; ticks may jump back. */
  record(tick: number, time: number): void {
    const slot = this.count % this.times.length;
    this.times[slot] = time;
    this.ticks[slot] = tick;
    this.count++;
  }

  /** The tick of the oldest stamp still held; the run's first tick when none is. */
  get oldest(): number {
    if (this.count === 0) return this.from;
    return this.ticks[this.first() % this.ticks.length]!;
  }

  /** When the oldest held stamp sounds; null when none is held. */
  get oldestTime(): number | null {
    if (this.count === 0) return null;
    return this.times[this.first() % this.times.length]!;
  }

  /**
   * The last recorded tick whose stamp is at or before `now + tolerance`, or
   * -1 when every held stamp is later than that (or none is held).
   */
  soundingAt(now: number, tolerance: number): number {
    const limit = now + tolerance;
    for (let i = this.count - 1; i >= this.first(); i--) {
      const slot = i % this.times.length;
      if (this.times[slot]! <= limit) return this.ticks[slot]!;
    }
    return -1;
  }

  /** The issue index of the oldest stamp still held. */
  private first(): number {
    return Math.max(0, this.count - this.times.length);
  }
}
