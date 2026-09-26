/**
 * The transport: one 24 PPQ clock fanning out to subscribers.
 *
 * Two layers, split so the tick maths is testable with no audio graph:
 *
 * - `TickTransport` is pure. It counts ticks, keeps the tick -> seconds
 *   mapping, and on every tick calls each subscriber whose divisor divides
 *   the tick. One clock for every subscriber is the point: a hat at 1/32 and a
 *   drone at one bar are phase-locked because they read the same counter
 *   (record `2026-08-31-generative-sequencing-transport-and-pitch` §1).
 * - `Scheduler` drives it with the look-ahead pattern. A coarse timer wakes
 *   periodically and queues ticks far enough ahead that the audio thread
 *   always has work stamped against its own clock. Notes are never triggered
 *   from the render loop directly: `requestAnimationFrame` jitters with frame
 *   time, and audio timing that jitters with frame rate is audible.
 *
 * Nothing here imports the audio graph. The clock the `Scheduler` reads is a
 * structural `{ currentTime }`, which an audio context satisfies and a test
 * fakes with a plain object.
 */

import {
  DEFAULT_BPM,
  NOTES_PER_BAR,
  SCHEDULER_LOOK_AHEAD_SECONDS,
  SCHEDULER_START_DELAY_SECONDS,
  SECONDS_PER_MINUTE,
  TICK_STAMP_EPSILON,
} from '../audioConstants';

/** Pulses per quarter note -- the MIDI-clock grid. */
export const PPQ = 24;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = PPQ * BEATS_PER_BAR;

/**
 * Step lengths as divisors in ticks. Every scale the design asks for is an
 * exact integer on the 24 PPQ grid; triplets (1/8T = 8, 1/16T = 4) fit too.
 */
export const DIVISORS = {
  bar: TICKS_PER_BAR,
  half: TICKS_PER_BAR / 2,
  quarter: TICKS_PER_BAR / NOTES_PER_BAR.quarter,
  eighth: TICKS_PER_BAR / NOTES_PER_BAR.eighth,
  sixteenth: TICKS_PER_BAR / NOTES_PER_BAR.sixteenth,
  thirtySecond: TICKS_PER_BAR / NOTES_PER_BAR.thirtySecond,
} as const;
export type DivisorName = keyof typeof DIVISORS;
export const DIVISOR_NAMES = Object.keys(DIVISORS) as readonly DivisorName[];

/** A divisor a bar-aligned generator may use: a positive integer that divides the bar. */
export function isBarDivisor(divisor: number): boolean {
  return Number.isInteger(divisor) && divisor > 0 && TICKS_PER_BAR % divisor === 0;
}

export interface TickEvent {
  /** Absolute tick since the transport was (re)started at tick 0. */
  tick: number;
  /** `tick / divisor` for the subscriber receiving this event. */
  step: number;
  bar: number;
  /** Position inside the bar; 0 is the bar line. */
  tickInBar: number;
  /** Transport time in seconds since tick 0, accumulated at the running tempo. */
  seconds: number;
  /** Seconds per tick at the tempo this tick was issued under. */
  secondsPerTick: number;
  /** Clock time the tick should sound at (audio-context time under the `Scheduler`). */
  time: number;
}

export type TickHandler = (event: TickEvent) => void;
export type Unsubscribe = () => void;

/** What a generator needs from the transport: a place to subscribe at a divisor. */
export interface TickSource {
  subscribe(divisor: number, handler: TickHandler): Unsubscribe;
}

interface Subscriber {
  divisor: number;
  handler: TickHandler;
}

/** The pure tick counter and fan-out. No clock of its own; `advance` is called per tick. */
export class TickTransport implements TickSource {
  bpm: number;
  private tick = 0;
  private seconds = 0;
  private subscribers: Subscriber[] = [];

  constructor(bpm = DEFAULT_BPM) {
    this.bpm = bpm;
  }

  get secondsPerTick(): number {
    return SECONDS_PER_MINUTE / this.bpm / PPQ;
  }

  /** The tick `advance()` will issue next. */
  get currentTick(): number {
    return this.tick;
  }

  get transportSeconds(): number {
    return this.seconds;
  }

  subscribe(divisor: number, handler: TickHandler): Unsubscribe {
    if (!Number.isInteger(divisor) || divisor < 1) {
      throw new RangeError(`divisor must be a positive integer of ticks, got ${divisor}`);
    }
    const entry: Subscriber = { divisor, handler };
    this.subscribers.push(entry);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== entry);
    };
  }

  reset(atTick = 0): void {
    this.tick = atTick;
    this.seconds = atTick * this.secondsPerTick;
  }

  /** Issue the current tick to every subscriber it falls on, then move to the next. */
  advance(time: number): void {
    const tick = this.tick;
    const secondsPerTick = this.secondsPerTick;
    const base = {
      tick,
      bar: Math.floor(tick / TICKS_PER_BAR),
      tickInBar: tick % TICKS_PER_BAR,
      seconds: this.seconds,
      secondsPerTick,
      time,
    };
    // Snapshot: a handler may unsubscribe itself or add a peer mid-tick.
    for (const { divisor, handler } of this.subscribers.slice()) {
      if (tick % divisor === 0) handler({ ...base, step: tick / divisor });
    }
    this.tick = tick + 1;
    this.seconds += secondsPerTick;
  }
}

/** Anything with a monotonic `currentTime` in seconds -- an audio context is one. */
export interface AudioClock {
  readonly currentTime: number;
}

export interface SchedulerOptions {
  /** Seconds of audio to keep queued ahead of now. */
  lookAhead?: number;
  bpm?: number;
}

/** Look-ahead driver for a `TickTransport` against a real clock. */
export class Scheduler implements TickSource {
  lookAhead: number;
  readonly transport: TickTransport;

  private readonly clock: AudioClock;
  private running = false;
  private nextTime = 0;

  constructor(clock: AudioClock, options: SchedulerOptions = {}) {
    this.clock = clock;
    this.lookAhead = options.lookAhead ?? SCHEDULER_LOOK_AHEAD_SECONDS;
    this.transport = new TickTransport(options.bpm ?? DEFAULT_BPM);
  }

  get bpm(): number {
    return this.transport.bpm;
  }

  set bpm(value: number) {
    this.transport.bpm = value;
  }

  get isRunning(): boolean {
    return this.running;
  }

  subscribe(divisor: number, handler: TickHandler): Unsubscribe {
    return this.transport.subscribe(divisor, handler);
  }

  /**
   * The tick sounding at clock time `now` (#603, the console's playhead). The
   * queue runs `lookAhead` ahead of the clock, so `transport.currentTick` is
   * where the *next issued* tick lands, not what is audible: tick `k` was
   * stamped `nextTime - (currentTick - k) * secondsPerTick`, and the audible
   * one is the last whose stamp is at or before `now`. 0 until the first tick
   * sounds; the last issued tick once the queue has run ahead and stopped.
   */
  audibleTick(now: number): number {
    const issued = this.transport.currentTick;
    const ahead = (this.nextTime - now) / this.transport.secondsPerTick;
    // Never past the last issued tick: a stopped queue does not keep counting.
    return Math.max(0, Math.min(issued - 1, Math.floor(issued - ahead + TICK_STAMP_EPSILON)));
  }

  start(atTick = 0): void {
    if (this.running) return;
    this.running = true;
    this.transport.reset(atTick);
    this.nextTime = this.clock.currentTime + SCHEDULER_START_DELAY_SECONDS;
  }

  /** Halt the queue, keeping the tick: `start(transport.currentTick)` resumes there (the mute path). */
  stop(): void {
    this.running = false;
  }

  /**
   * Halt and rewind to tick 0 (#708, epic #703 decision 8's ■): `audibleTick`
   * reads 0 and the next `start` issues tick 0 first. What the region state
   * and held notes need is the player's (`ArrangementPlayer.reset`).
   */
  reset(): void {
    this.stop();
    this.transport.reset(0);
    this.nextTime = 0;
  }

  /**
   * Advance the queue. Driven by the render loop, but what it emits is timed
   * against the audio clock, so frame-rate variation cannot shift a note.
   */
  update(): void {
    if (!this.running) return;
    const horizon = this.clock.currentTime + this.lookAhead;
    while (this.nextTime < horizon) {
      this.transport.advance(this.nextTime);
      this.nextTime += this.transport.secondsPerTick;
    }
  }
}
