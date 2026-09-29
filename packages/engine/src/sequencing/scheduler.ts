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
 *   from a frame callback directly: `requestAnimationFrame` jitters with frame
 *   time, and audio timing that jitters with frame rate is audible.
 *
 * Swing (windsor#14) lives here too, in the one clock, so it reaches every
 * part: each tick interval lasts `swingSlope` straight ticks (`swing.ts`),
 * which moves the off-beat of each pair and leaves the pair boundaries on the
 * grid. Straight, every slope is exactly 1 and the clock is bit for bit the
 * pre-swing one.
 *
 * The loop (windsor#15) lives here for the same reason: with a `TickLoop`
 * set, the tick after the loop's last one is its first, so the counter jumps
 * back from `end` to `start` exactly where the song's end would have folded
 * it to 0. The transport's seconds keep running across the jump, and the
 * points sit on beats, so every swing pair keeps its phase.
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
import { playableSwing, swingSlope, swingTicks, unswingTicks } from './swing';
import { TickStamps } from './tickStamps';
import { STRAIGHT_SWING, SWING_TABLE, type Swing, type SwingTable } from './swingTables';

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

/**
 * The span the clock wraps (windsor#15): the tick after the one before `end`
 * is `start`. Both are song ticks in `[0, songTicks]`, positions mod
 * `songTicks`, since the counter itself never folds at the song's end.
 */
export interface TickLoop {
  readonly start: number;
  readonly end: number;
  readonly songTicks: number;
}

/**
 * The tick `advance` issues after `tick`: one on, or the loop's start in
 * place of its end. A loop covering the whole song is the song's own wrap
 * and jumps nothing; an empty or inverted one is ignored.
 */
export function followingTick(tick: number, loop: TickLoop | null): number {
  const next = tick + 1;
  if (!loop) return next;
  const { start, end, songTicks } = loop;
  const span = end - start;
  if (!(span > 0) || span >= songTicks) return next;
  return (next - end) % songTicks === 0 ? next - span : next;
}

/** True when `tick` following `last` is the loop's jump back, not a step or a restart elsewhere. */
export function isLoopJump(last: number, tick: number, loop: TickLoop | null): boolean {
  return tick !== last + 1 && tick === followingTick(last, loop);
}

export interface TickEvent {
  /**
   * Transport tick since the transport was (re)started. It counts on past
   * the song's end (positions are `tick mod songTicks`) and jumps back only
   * at a loop's end (windsor#15).
   */
  tick: number;
  /** `tick / divisor` for the subscriber receiving this event. */
  step: number;
  bar: number;
  /** Position inside the bar; 0 is the bar line. */
  tickInBar: number;
  /** Transport time in seconds since tick 0, accumulated at the running tempo and swing. */
  seconds: number;
  /** Seconds per straight tick at the tempo this tick was issued under. */
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
  /** The loop the counter wraps (windsor#15); null plays through, today's rule. */
  loop: TickLoop | null = null;
  private playing: Swing;
  private tick = 0;
  private seconds = 0;
  private subscribers: Subscriber[] = [];

  constructor(
    bpm = DEFAULT_BPM,
    swing: Swing = STRAIGHT_SWING,
    private readonly swingTable: SwingTable = SWING_TABLE,
  ) {
    this.bpm = bpm;
    this.playing = playableSwing(swing, swingTable);
  }

  /**
   * The song's swing (windsor#14): read per tick, so a live edit lands on the
   * next one. Clamped through `playableSwing` on the way in, so no caller can
   * hand the clock an amount that collapses or reverses a tick.
   */
  get swing(): Swing {
    return this.playing;
  }

  set swing(value: Swing) {
    this.playing = playableSwing(value, this.swingTable);
  }

  get secondsPerTick(): number {
    return SECONDS_PER_MINUTE / this.bpm / PPQ;
  }

  /** Seconds from `tick` to `tick + 1` at the running tempo and swing. */
  intervalSeconds(tick: number): number {
    return this.secondsPerTick * swingSlope(tick, this.swing, this.swingTable);
  }

  /** Where tick position `tick` sounds, in straight ticks from 0 (`swing.ts`). */
  swungTicks(tick: number): number {
    return swingTicks(tick, this.swing, this.swingTable);
  }

  /** The inverse of `swungTicks`. */
  unswungTicks(warped: number): number {
    return unswingTicks(warped, this.swing, this.swingTable);
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
    this.seconds = this.swungTicks(atTick) * this.secondsPerTick;
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
    this.tick = followingTick(tick, this.loop);
    this.seconds += this.intervalSeconds(tick);
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
  /** The song's swing (windsor#14); straight when absent. */
  swing?: Swing;
  /** The warp's table; the shipped one when absent. */
  swingTable?: SwingTable;
}

/** Look-ahead driver for a `TickTransport` against a real clock. */
export class Scheduler implements TickSource {
  lookAhead: number;
  readonly transport: TickTransport;

  private readonly clock: AudioClock;
  private running = false;
  /** Rewound (constructed, or `reset`) and not started since: where ▶ begins follows the loop. */
  private atRest = true;
  private nextTime = 0;
  /** The tick the last rewind put the transport on: 0, or a loop's start (windsor#15). */
  private restTick = 0;
  /** What each recent tick was actually stamped: `audibleTick` reads these. */
  private readonly stamps = new TickStamps();

  constructor(clock: AudioClock, options: SchedulerOptions = {}) {
    this.clock = clock;
    this.lookAhead = options.lookAhead ?? SCHEDULER_LOOK_AHEAD_SECONDS;
    this.transport = new TickTransport(
      options.bpm ?? DEFAULT_BPM,
      options.swing ?? STRAIGHT_SWING,
      options.swingTable ?? SWING_TABLE,
    );
  }

  get bpm(): number {
    return this.transport.bpm;
  }

  set bpm(value: number) {
    this.transport.bpm = value;
  }

  get swing(): Swing {
    return this.transport.swing;
  }

  set swing(value: Swing) {
    this.transport.swing = value;
  }

  get loop(): TickLoop | null {
    return this.transport.loop;
  }

  /**
   * The song's loop (windsor#15), live: the next tick past its end wraps. At
   * rest the rewound position follows it, so ▶ starts at the loop's start
   * while it is on and at 0 while it is off; a paused or running transport
   * keeps its tick, and one already past the end plays on to the song's end,
   * folds to 0, and wraps from the loop's end after that.
   */
  set loop(value: TickLoop | null) {
    this.transport.loop = value;
    const rest = value?.start ?? 0;
    if (this.atRest && this.transport.currentTick !== rest) this.rewind(rest);
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
   * where the *next issued* tick lands, not what is audible: the audible one
   * is the last whose stamp is at or before `now`. The stamps read are the
   * ones actually issued (windsor#14), so a live swing or tempo change moves
   * only the ticks queued after it and the playhead never runs backward
   * while the old queue drains. The last issued tick once the queue has run
   * ahead and stopped.
   */
  audibleTick(now: number): number {
    const secondsPerTick = this.transport.secondsPerTick;
    const sounding = this.stamps.soundingAt(now, TICK_STAMP_EPSILON * secondsPerTick);
    if (sounding >= 0) return sounding;
    // No held stamp has sounded yet (before the run's first tick, or older
    // than the ring): count back at the running tempo and swing from the
    // oldest held stamp, or the queue's head when none is held, never
    // reaching that tick. Counting from the oldest stamp keeps a loop's jump
    // (windsor#15) queued after it out of the count. The rewound tick (0, or
    // the loop's start) before anything sounds.
    const oldestTime = this.stamps.oldestTime;
    const anchor = oldestTime === null ? this.transport.currentTick : this.stamps.oldest;
    const ahead = ((oldestTime ?? this.nextTime) - now) / secondsPerTick;
    const tick = this.transport.unswungTicks(this.transport.swungTicks(anchor) - ahead);
    const floor = Math.min(this.restTick, anchor);
    return Math.max(floor, Math.min(anchor - 1, Math.floor(tick + TICK_STAMP_EPSILON)));
  }

  /**
   * Run from `atTick`. Resuming where the queue stopped keeps the transport's
   * accumulated seconds: they carry every swing and tempo the song has played
   * (windsor#14), which a recompute from tick 0 under the current ones would
   * lose. Only a start at another tick recomputes them.
   */
  start(atTick = 0): void {
    if (this.running) return;
    this.running = true;
    this.atRest = false;
    if (atTick !== this.transport.currentTick) this.transport.reset(atTick);
    this.stamps.clear(atTick);
    this.nextTime = this.clock.currentTime + SCHEDULER_START_DELAY_SECONDS;
  }

  /** Halt the queue, keeping the tick: `start(transport.currentTick)` resumes there (the mute path). */
  stop(): void {
    this.running = false;
  }

  /**
   * Halt and rewind (#708, epic #703 decision 8's ■): to tick 0, or to the
   * loop's start while a loop is on (windsor#15). `audibleTick` reads that
   * tick and the next `start` issues it first. What the region state and
   * held notes need is the player's (`ArrangementPlayer.reset`).
   */
  reset(atTick = this.transport.loop?.start ?? 0): void {
    this.stop();
    this.atRest = true;
    this.rewind(atTick);
  }

  /**
   * Move a halted transport to `tick` (windsor#102, the Song view's playhead
   * drag): `audibleTick` reads it and the next `start` issues it first,
   * whether the transport was stopped or paused. The position is now the
   * user's, so a later loop edit leaves it where it is, as it leaves a paused
   * one. With a loop on, a tick before the loop plays on into it and wraps
   * there as usual. Refused (false, nothing changed) while running, or for a
   * tick that is not a non-negative integer.
   */
  seek(tick: number): boolean {
    if (this.running || !Number.isInteger(tick) || tick < 0) return false;
    this.atRest = false;
    this.rewind(tick);
    return true;
  }

  private rewind(atTick: number): void {
    this.restTick = atTick;
    this.transport.reset(atTick);
    this.stamps.clear(atTick);
    this.nextTime = 0;
  }

  /**
   * Advance the queue. Driven by the host's timer, but what it emits is timed
   * against the audio clock, so a late wake-up cannot shift a note.
   */
  update(): void {
    if (!this.running) return;
    const horizon = this.clock.currentTime + this.lookAhead;
    while (this.nextTime < horizon) {
      const tick = this.transport.currentTick;
      this.stamps.record(tick, this.nextTime);
      this.transport.advance(this.nextTime);
      this.nextTime += this.transport.intervalSeconds(tick);
    }
  }
}
