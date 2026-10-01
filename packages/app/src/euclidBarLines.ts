/**
 * The transport seconds the scheduler stamped on the bar lines it issued
 * (windsor#383, decision 3): what an Hz LFO read there (`TickEvent.seconds`,
 * the sequencer's `nextK`). The Euclid card's Hz plot anchors on the audible
 * bar's stamp, so a live tempo or swing edit with ticks already queued
 * cannot move a bar line that was issued at the old timing: rewinding the
 * clock's accumulated seconds at the new `secondsPerTick` would
 * (`barLineSeconds`). Before the card has seen its bar's line issued (it
 * opened mid-bar, or the transport was moved), the plot falls back to that
 * rewind, which is exact while the timing has not changed since.
 */
import type { TickEvent, TickSource, Unsubscribe } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { type SecondsClock, barLineSeconds } from './euclidDensityModel';

/** One issued bar line: its tick, the transport seconds on it, and the clock time it sounds at. */
export type BarLineStamp = Pick<TickEvent, 'tick' | 'seconds' | 'time'>;

/** Bar lines kept: the look-ahead's few, and a short loop's repeats of one line. */
const BAR_LINES_KEPT = 8;

/** The bar lines issued lately, oldest first. */
export class BarLineLog {
  private stamps: BarLineStamp[] = [];

  constructor(private readonly keep = BAR_LINES_KEPT) {}

  record(event: BarLineStamp): void {
    this.stamps.push({ tick: event.tick, seconds: event.seconds, time: event.time });
    if (this.stamps.length > this.keep) this.stamps.shift();
  }

  clear(): void {
    this.stamps = [];
  }

  /**
   * The seconds on line `line`'s latest issue to have sounded by clock time
   * `now` (within `slack`, the playhead's own tolerance); null when the log
   * holds none. A loop issues one line again and again; a queued repeat
   * that has not sounded is not the one playing.
   */
  secondsAt(line: number, now: number, slack = 0): number | null {
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const stamp = this.stamps[i];
      if (stamp && stamp.tick === line && stamp.time <= now + slack) return stamp.seconds;
    }
    return null;
  }
}

/** The scheduler's bar lines for one card: subscribed to the live system's, and moved to a rebuilt one. */
export class BarLineWatch {
  readonly log: BarLineLog;
  private source: TickSource | null = null;
  private stop: Unsubscribe | null = null;

  constructor(log = new BarLineLog()) {
    this.log = log;
  }

  /** Watch `source`'s bar lines (none for null); a new source starts an empty log. */
  follow(source: TickSource | null, ticksPerBar = TICKS_PER_BAR): void {
    if (source === this.source) return;
    this.close();
    this.source = source;
    if (source) this.stop = source.subscribe(ticksPerBar, (event) => this.log.record(event));
  }

  /** Stop watching and forget what was seen: the card has left the page. */
  close(): void {
    this.stop?.();
    this.stop = null;
    this.source = null;
    this.log.clear();
  }
}

/**
 * The transport seconds on the line of the bar holding the audible tick
 * `tick`: the scheduler's stamp when the log holds the line's issue that
 * sounded by `now`, else `barLineSeconds`'s rewind of the clock.
 */
export function plotSeconds(
  log: BarLineLog,
  clock: SecondsClock,
  at: { readonly tick: number; readonly now: number },
  ticksPerBar = TICKS_PER_BAR,
): number {
  const line = at.tick - (at.tick % ticksPerBar);
  const stamped = log.secondsAt(line, at.now, clock.secondsPerTick);
  return stamped ?? barLineSeconds(clock, at.tick, ticksPerBar);
}
