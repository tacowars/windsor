/**
 * The recorder's reading of the playhead (windsor#663, issue decision 4's
 * ordering): before the take is handed any press or release it is advanced
 * to the tick heard now, so a transport loop's jump is observed before the
 * event that follows it.
 *
 * A jump can come and go between two readings: a key pressed at 98 in a loop
 * of 96..104, held through the jump at 104, and released at 100 of the next
 * pass reads 98 then 100, which looks like two ticks of one pass. Nothing
 * redraws in between when the page is hidden or the release lands first, so
 * the reading judges the jump from the clock: the ticks the context time
 * says have passed since the last reading, against the ticks the transport
 * moved. More than half a loop apart, the loop wrapped, and the take is
 * first advanced to the loop's end, where each note of the old pass is cut.
 */
import type { TickLoop } from '@windsor/engine';

/** A reading of the playhead: the transport tick heard, and the context time it was heard at (seconds). */
export interface TapReading {
  readonly tick: number;
  readonly time: number;
}

/** The first transport tick at or after `tick` that the loop's end falls on. */
export function nextLoopEnd(tick: number, loop: TickLoop): number {
  const { end, songTicks } = loop;
  return tick + ((((end - tick) % songTicks) + songTicks) % songTicks);
}

/** A loop the clock really wraps: not empty, inverted or the whole song. */
const wraps = (loop: TickLoop | null): loop is TickLoop =>
  loop !== null && loop.end > loop.start && loop.end - loop.start < loop.songTicks;

/** The readings the take's playhead has seen, judging the jumps between them. */
export class TapClock {
  private last: TapReading | null = null;

  /** Forget the last reading: a new take, or a take's end. */
  reset(): void {
    this.last = null;
  }

  /**
   * The ticks the take is advanced through to reach `now`: the loop's end
   * first when the loop wrapped since the last reading, then `now`'s tick.
   */
  observe(now: TapReading, loop: TickLoop | null, secondsPerTick: number): number[] {
    const last = this.last;
    this.last = now;
    if (!last || !wraps(loop) || !(secondsPerTick > 0)) return [now.tick];
    const end = nextLoopEnd(last.tick, loop);
    const expected = last.tick + (now.time - last.time) / secondsPerTick;
    const span = loop.end - loop.start;
    const wrapped = now.tick < end && expected >= end && expected - now.tick > span / 2;
    return wrapped ? [end, now.tick] : [now.tick];
  }
}
