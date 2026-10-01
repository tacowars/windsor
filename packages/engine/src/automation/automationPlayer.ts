/**
 * The automation player (windsor#344, record
 * `2026-10-01-song-automation-lanes` decision 8): every part's lanes that are
 * on, played from the one clock as AudioParam events.
 *
 * - **Each tick, one window.** It hears every tick on the transport, before
 *   any part's gate, and schedules `rampsBetween`'s breakpoints in that
 *   tick's window `[pos, pos + 1)` (the song position, the transport tick
 *   folded by the song's length) from the tick's `time`: a linear ramp to
 *   each, a fractional tick at its share of the tick's interval. So a bent
 *   or logarithmic segment is cut every tick and the curve is scheduled as
 *   it enters the look-ahead. A step, two breakpoints on one tick, is
 *   `set(prev)` then a ramp to the new value over `AUTOMATION_STEP_RAMP_SECONDS`.
 * - **Discontinuities.** A tick that does not follow the last one (a start,
 *   the loop's jump back, the song's wrap) cancels each lane from its time,
 *   holds the value at its position there, and schedules on. A live lane edit
 *   or a tempo change (`setLanes`, `resync`) does the same from now, then
 *   schedules again every tick already issued past now.
 * - **Stopped.** A stop holds each lane at the value where the playhead
 *   stood. A seek while stopped holds each at the value at the new tick; so
 *   does a lane edit while stopped, at the position the playhead rests on.
 * - **Lane off or deleted.** Its handle is released: the target goes back to
 *   its owner's value now.
 *
 * Offline render pumps the same clock, so it gets the same events
 * (`render/renderPass.ts`). The worklets never learn song time.
 */
import type { TickEvent, TickHandler, Unsubscribe } from '../sequencing/scheduler';
import { AUTOMATION_STEP_RAMP_SECONDS } from './automationConstants';
import type { AutomationRamp } from './automationEvaluate';
import { rampsBetween, valueAt } from './automationEvaluate';
import type { AutomationHandle } from './automationHandles';
import type {
  AutomationLane,
  AutomationPoint,
  AutomationTargetId,
  AutomationTargetRow,
} from './automationLane';

/** A lane's target, found on the live graph: its writer and its row. */
export interface ResolvedTarget {
  readonly handle: AutomationHandle;
  readonly row: AutomationTargetRow;
}

/** Finds a part's target on the live graph; undefined when it has none (yet). */
export type AutomationResolver = (
  slot: number,
  target: AutomationTargetId,
) => ResolvedTarget | undefined;

/** What the player needs of the transport: `TickTransport` satisfies it. */
export interface AutomationClock {
  subscribe(divisor: number, handler: TickHandler): Unsubscribe;
  /** Seconds from `tick` to the next at the running tempo and swing. */
  intervalSeconds(tick: number): number;
}

export interface AutomationPlayerOptions {
  readonly transport: AutomationClock;
  /** The audio clock's time now. */
  readonly now: () => number;
  readonly resolve: AutomationResolver;
  /** The song's length: a transport tick plays the lanes at `tick mod songTicks`. */
  readonly songTicks: number;
  /** Where the stopped transport rests: where lanes are first held. */
  readonly restTick: number;
  /** The de-click on a step; the shipped constant when absent. */
  readonly stepSeconds?: number;
}

/** A lane that plays: its points, its row and its writer, and its last event's time. */
interface Playing {
  readonly target: AutomationTargetId;
  readonly points: readonly AutomationPoint[];
  readonly row: AutomationTargetRow;
  readonly handle: AutomationHandle;
  last: number;
}

/** A tick the transport issued: its song position, time and length, and whether it jumped. */
interface Issued {
  readonly pos: number;
  readonly time: number;
  readonly interval: number;
  readonly jump: boolean;
}

const fold = (tick: number, songTicks: number): number =>
  ((tick % songTicks) + songTicks) % songTicks;

export class AutomationPlayer {
  private readonly lanes = new Map<number, readonly AutomationLane[]>();
  private readonly playing = new Map<number, Playing[]>();
  /** The ticks issued since the transport started, from the one sounding now on. */
  private issued: Issued[] = [];
  private lastPos: number | null = null;
  private songTicks: number;
  /** The song position the stopped playhead rests on; fractional after a stop mid-tick. */
  private restPos: number;
  private readonly stepSeconds: number;
  private readonly unfollow: Unsubscribe;

  constructor(private readonly options: AutomationPlayerOptions) {
    this.songTicks = options.songTicks;
    this.restPos = fold(options.restTick, options.songTicks);
    this.stepSeconds = options.stepSeconds ?? AUTOMATION_STEP_RAMP_SECONDS;
    this.unfollow = options.transport.subscribe(1, (event) => this.follow(event));
  }

  /** Whether the transport has issued a tick since the last stop or seek. */
  get running(): boolean {
    return this.lastPos !== null;
  }

  /**
   * A part's whole lane list (a live edit, or its lanes at build): every
   * lane that was on and no longer is gives its target back, and the lanes
   * now on are held where the playhead is and scheduled on from there.
   */
  setLanes(slot: number, lanes: readonly AutomationLane[]): void {
    const before = this.playing.get(slot) ?? [];
    this.lanes.set(slot, lanes);
    const next = this.resolvePart(slot);
    const now = this.options.now();
    for (const lane of before) {
      if (!next.some((p) => p.target === lane.target)) lane.handle.release(now);
    }
    this.restart(next, now);
  }

  /** A part leaving the song: its lanes are forgotten, its strip goes with it. */
  removePart(slot: number): void {
    this.lanes.delete(slot);
    this.playing.delete(slot);
  }

  /** The song's length changed (`transport.bars`): positions fold by the new one. */
  setSongTicks(songTicks: number): void {
    this.songTicks = songTicks;
  }

  /**
   * Find every lane's target again and restart it from now: a tempo change,
   * a song-length change, or a part whose inserts or patch changed. One part
   * by slot, or every part.
   */
  resync(slot?: number): void {
    const now = this.options.now();
    for (const each of slot === undefined ? [...this.lanes.keys()] : [slot]) {
      if (this.lanes.has(each)) this.restart(this.resolvePart(each), now);
    }
  }

  /** The transport stopped: each lane holds its value where the playhead stood. */
  stop(): void {
    if (this.running) this.restPos = this.positionAt(this.options.now());
    this.forget();
    this.holdAll();
  }

  /** The stopped transport moved to `tick`: each lane holds its value there. */
  seek(tick: number): void {
    this.restPos = fold(tick, this.songTicks);
    this.forget();
    this.holdAll();
  }

  dispose(): void {
    this.unfollow();
    this.lanes.clear();
    this.playing.clear();
    this.forget();
  }

  /** Every tick: record it, then schedule its window on every lane. */
  private follow(event: TickEvent): void {
    const pos = fold(event.tick, this.songTicks);
    const jump = this.lastPos === null || pos !== this.lastPos + 1;
    this.lastPos = pos;
    const interval = this.options.transport.intervalSeconds(event.tick);
    const issued: Issued = { pos, time: event.time, interval, jump };
    this.issued.push(issued);
    this.prune(this.options.now());
    for (const lanes of this.playing.values()) {
      for (const lane of lanes) this.window(lane, issued);
    }
  }

  /** One tick's breakpoints on one lane: after a jump, a hold at the tick first. */
  private window(lane: Playing, issued: Issued): void {
    const { pos, time, interval, jump } = issued;
    if (jump) {
      lane.handle.hold(valueAt(lane.row, lane.points, pos), time);
      lane.last = time;
    }
    const ramps = rampsBetween(lane.row, lane.points, { fromTick: pos, toTick: pos + 1 });
    let prev: AutomationRamp | undefined;
    for (const ramp of ramps) {
      // After a jump the hold is already the value at `pos`, a step's included.
      if (!(jump && ramp.tick === pos)) {
        const at = Math.max(lane.last, time + (ramp.tick - pos) * interval);
        if (prev?.tick === ramp.tick) {
          lane.handle.schedule(prev.value, at, 'set');
          lane.handle.schedule(ramp.value, at + this.stepSeconds, 'ramp');
          lane.last = at + this.stepSeconds;
        } else {
          lane.handle.schedule(ramp.value, at, 'ramp');
          lane.last = at;
        }
      }
      prev = ramp;
    }
  }

  /** Hold `lanes` at the playhead now, then schedule again every tick issued past now. */
  private restart(lanes: Playing[], now: number): void {
    const pos = this.running ? this.positionAt(now) : this.restPos;
    for (const lane of lanes) {
      lane.handle.hold(valueAt(lane.row, lane.points, pos), now);
      lane.last = now;
    }
    for (const issued of this.issued) {
      if (issued.time <= now) continue;
      for (const lane of lanes) this.window(lane, issued);
    }
  }

  private holdAll(): void {
    const now = this.options.now();
    for (const lanes of this.playing.values()) this.restart(lanes, now);
  }

  /** The lanes of `slot` that are on and whose target the graph has, resolved now. */
  private resolvePart(slot: number): Playing[] {
    const out: Playing[] = [];
    for (const lane of this.lanes.get(slot) ?? []) {
      if (!lane.on || lane.points.length === 0) continue;
      const resolved = this.options.resolve(slot, lane.target);
      if (resolved) out.push({ target: lane.target, points: lane.points, ...resolved, last: 0 });
    }
    this.playing.set(slot, out);
    return out;
  }

  /**
   * The song position sounding at `now`: inside the last issued tick at or
   * before it, by its share of the tick's interval; the first issued tick
   * when none has sounded yet.
   */
  private positionAt(now: number): number {
    let at: Issued | undefined;
    for (const issued of this.issued) {
      if (issued.time > now) break;
      at = issued;
    }
    if (!at) return this.issued[0]?.pos ?? this.restPos;
    const share = at.interval > 0 ? (now - at.time) / at.interval : 0;
    return at.pos + Math.min(1, Math.max(0, share));
  }

  /** Drop the ticks that sounded before the one sounding at `now`. */
  private prune(now: number): void {
    let drop = 0;
    while (drop + 1 < this.issued.length && this.issued[drop + 1]!.time <= now) drop++;
    if (drop > 0) this.issued.splice(0, drop);
  }

  private forget(): void {
    this.lastPos = null;
    this.issued = [];
  }
}
