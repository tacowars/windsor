/**
 * Scale's Song chord on the transport (windsor#729, record
 * `2026-10-11-bloom-follows-the-song` decision 8): the pitch set of the chord
 * the harmony track is on, scheduled the way the automation player schedules
 * a lane (`automation/automationPlayer.ts`) and handed to every bloom through
 * `harmonyInsertRegistry`'s `setChord`.
 *
 * - **Each tick.** It hears every tick (`subscribe(1, …)`), folds it by the
 *   song's length, and looks its set up (`bloomChordTimeline.ts`). Where the
 *   set changes it is scheduled one fade early (`BLOOM_GENERATOR.switchSeconds`):
 *   the worklet dips over the fade, retunes, and comes back up, so the retune
 *   lands on the chord's boundary. Consecutive chords on one set schedule
 *   nothing.
 * - **Discontinuities.** A tick that does not follow the last (a start, the
 *   loop's jump back, the song's wrap) cancels from its time and holds its set.
 * - **Re-plan.** `setSong`, after every live edit that landed, rebuilds the
 *   timeline, holds the set under the playhead from now and schedules again
 *   every tick already issued past now; `replan` alone does the same for a
 *   bloom created since.
 * - **Stopped.** A stop holds the set where the playhead stood; a seek, or ■'s
 *   rewind, the set at the new tick; a re-plan while stopped, the set where
 *   the playhead rests.
 * - **No allocation per tick.** The ticks issued and not yet sounded are kept
 *   in typed arrays, which grow only when full.
 *
 * Offline render pumps the same clock, so it gets the same events
 * (`render/renderPass.ts`).
 */
import type { Harmony } from '../harmony/harmonyTimeline';
import type { TickEvent, TickSource, Unsubscribe } from '../sequencing/scheduler';
import { chordMaskAt, chordTimeline } from './bloomChordTimeline';
import type { ChordTimeline } from './bloomChordTimeline';
import { BLOOM_GENERATOR } from './bloomGeneratorConstants';

/** Where the sets go (`harmonyInsertRegistry`'s `setChord`): a hold cancels from `time` first. */
export type ChordSink = (mask: number, time: number, hold: boolean) => void;

export interface ChordFollowerOptions {
  readonly transport: TickSource;
  /** The audio clock's time now. */
  readonly now: () => number;
  readonly sink: ChordSink;
  readonly harmony: Harmony;
  /** The song's length: a transport tick plays the chord at `tick mod songTicks`. */
  readonly songTicks: number;
  /** Where the stopped transport rests: where the chord is first held. */
  readonly restTick: number;
  /** How early a change is scheduled; the worklet's fade when absent. */
  readonly fadeSeconds?: number;
}

const fold = (tick: number, songTicks: number): number =>
  ((tick % songTicks) + songTicks) % songTicks;

export class BloomChordFollower {
  private timeline: ChordTimeline;
  private songTicks: number;
  /** The song position the stopped playhead rests on. */
  private restPos: number;
  /** The transport ticks issued since the start, from the one sounding now on, and their times. */
  private ticks = new Float64Array(2);
  private times = new Float64Array(2);
  private count = 0;
  /** The last issued tick's song position; −1 while stopped. */
  private lastPos = -1;
  /** The set and the time of the last event handed over. */
  private lastMask = -1;
  private last = -Infinity;
  private readonly fade: number;
  private readonly unfollow: Unsubscribe;

  constructor(private readonly options: ChordFollowerOptions) {
    this.timeline = chordTimeline(options.harmony, options.songTicks);
    this.songTicks = options.songTicks;
    this.restPos = fold(options.restTick, options.songTicks);
    this.fade = options.fadeSeconds ?? BLOOM_GENERATOR.switchSeconds;
    this.unfollow = options.transport.subscribe(1, (event) => this.follow(event));
    this.replan();
  }

  /** The song's harmony or length changed, or anything else that moves a chord or its time: re-plan. */
  setSong(harmony: Harmony, songTicks: number): void {
    this.timeline = chordTimeline(harmony, songTicks);
    this.songTicks = songTicks;
    // The next tick follows the last under the new length, not as a jump.
    if (this.lastPos >= 0) this.lastPos = fold(this.ticks[this.count - 1]!, songTicks);
    this.replan();
  }

  /**
   * Hold the set under the playhead now (one fade ahead, where a change
   * scheduled early has already started), then schedule every issued tick
   * past now again.
   */
  replan(): void {
    const now = this.options.now();
    const pos = this.lastPos < 0 ? this.restPos : this.positionAt(now + this.fade);
    this.hand(chordMaskAt(this.timeline, pos), now, true);
    for (let i = 0; i < this.count; i++) {
      if (this.times[i]! > now) this.schedule(fold(this.ticks[i]!, this.songTicks), this.times[i]!);
    }
  }

  /** The transport halted: hold the set where the playhead stood. */
  stop(): void {
    const now = this.options.now();
    if (this.lastPos >= 0) this.restPos = this.positionAt(now);
    this.forget();
    this.hand(chordMaskAt(this.timeline, this.restPos), now, true);
  }

  /** The halted transport moved to `tick`: hold the set there. */
  seek(tick: number): void {
    this.restPos = fold(tick, this.songTicks);
    this.forget();
    this.hand(chordMaskAt(this.timeline, this.restPos), this.options.now(), true);
  }

  /** ■ rewound the halted transport to `tick`: as a seek. */
  rewound(tick: number): void {
    this.seek(tick);
  }

  dispose(): void {
    this.unfollow();
    this.forget();
  }

  /** Every tick: record it, then hold its set after a jump, or schedule a change. */
  private follow(event: TickEvent): void {
    const pos = fold(event.tick, this.songTicks);
    const jump = this.lastPos < 0 || pos !== this.lastPos + 1;
    this.lastPos = pos;
    this.record(event.tick, event.time);
    this.prune(this.options.now());
    if (jump) {
      const at = Math.max(this.last, event.time - this.fade);
      this.hand(chordMaskAt(this.timeline, pos), at, true);
    } else {
      this.schedule(pos, event.time);
    }
  }

  /** The set at `pos`, one fade before `time`, when it differs from the last handed over. */
  private schedule(pos: number, time: number): void {
    const mask = chordMaskAt(this.timeline, pos);
    if (mask !== this.lastMask) this.hand(mask, Math.max(this.last, time - this.fade), false);
  }

  private hand(mask: number, time: number, hold: boolean): void {
    this.options.sink(mask, time, hold);
    this.lastMask = mask;
    this.last = time;
  }

  /** The song position sounding at `time`: the last issued tick at or before it, else the first. */
  private positionAt(time: number): number {
    let at = 0;
    while (at + 1 < this.count && this.times[at + 1]! <= time) at++;
    return this.count > 0 ? fold(this.ticks[at]!, this.songTicks) : this.restPos;
  }

  private record(tick: number, time: number): void {
    if (this.count === this.ticks.length) {
      const ticks = new Float64Array(this.count * 2);
      const times = new Float64Array(this.count * 2);
      ticks.set(this.ticks);
      times.set(this.times);
      this.ticks = ticks;
      this.times = times;
    }
    this.ticks[this.count] = tick;
    this.times[this.count] = time;
    this.count++;
  }

  /** Drop the ticks that sounded before the one sounding at `now`. */
  private prune(now: number): void {
    let drop = 0;
    while (drop + 1 < this.count && this.times[drop + 1]! <= now) drop++;
    if (drop === 0) return;
    this.ticks.copyWithin(0, drop, this.count);
    this.times.copyWithin(0, drop, this.count);
    this.count -= drop;
  }

  private forget(): void {
    this.lastPos = -1;
    this.count = 0;
  }
}
