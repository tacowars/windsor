/**
 * The automation player (windsor#344, record
 * `2026-10-01-song-automation-lanes` decision 8): every part's and every
 * group's lanes that are on, played from the one clock as AudioParam events.
 * Lane lists are keyed by their owner, a part's slot or a group's id
 * (`automationOwner.ts`, windsor#614); the timing below is the same for both.
 *
 * - **Each tick, one window.** It hears every tick on the transport, before
 *   any part's gate, and schedules `rampsBetween`'s breakpoints in that
 *   tick's window `[pos, pos + 1)` (the song position, the transport tick
 *   folded by the song's length) from the tick's `time`: a linear ramp to
 *   each, a fractional tick at its share of the tick's interval. So a bent
 *   or logarithmic segment is cut every tick and the curve is scheduled as
 *   it enters the look-ahead. A step, two breakpoints on one tick, is
 *   `set(prev)` then a ramp to the new value over `AUTOMATION_STEP_RAMP_SECONDS`.
 * - **A switch lane** (windsor#628) only ever `set`s: each point, a step's
 *   two included, is a jump at its time, never a ramp.
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
 * - **Sequencer lanes** (`seq.`, windsor#488) have no handle on the graph:
 *   the region gate reads them, and this player passes them by.
 *
 * - **Clip envelopes** (windsor#702): a part's roll may carry envelopes on
 *   its voice targets (`setEnvelopes`). Each tick, the part's
 *   `ClipEnvelopeTracks` write their targets first, a lane on the same
 *   target summed in, and the player passes those lanes by for that tick.
 *   A restart rewinds them with the lanes; a stop ramps a playing envelope
 *   out and gives its slot back once the ramp is over (`defer`). A part
 *   whose regions play no envelope has no tracks, and its lanes play
 *   exactly as before.
 *
 * Offline render pumps the same clock, so it gets the same events
 * (`render/renderPass.ts`). The worklets never learn song time.
 */
import { MS_PER_SECOND } from '../audioConstants';
import type { TickEvent, TickHandler, Unsubscribe } from '../sequencing/scheduler';
import { AUTOMATION_STEP_RAMP_SECONDS } from './automationConstants';
import type { AutomationRamp } from './automationEvaluate';
import { rampsBetween, valueAt } from './automationEvaluate';
import type { AutomationHandle } from './automationHandles';
import type { AutomationOwner } from './automationOwner';
import { ownerKey, partOwner } from './automationOwner';
import type {
  AutomationLane,
  AutomationPoint,
  AutomationTargetId,
  AutomationTargetRow,
} from './automationLane';
import { FM_LANES_MAX } from './automationTargetTables';
import { targetKind } from './automationTargets';
import type { ClipEnvelopeSource } from './clipEnvelopeSource';
import { ClipEnvelopeTracks, type RewindAt } from './clipEnvelopeTracks';

/** A lane's target, found on the live graph: its writer and its row. */
export interface ResolvedTarget {
  readonly handle: AutomationHandle;
  readonly row: AutomationTargetRow;
}

/** Finds an owner's target on the live graph; undefined when it has none (yet). */
export type AutomationResolver = (
  owner: AutomationOwner,
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
  /**
   * How a stop waits out a clip envelope's ramp out before its slot is
   * given back (windsor#702): `setTimeout` when absent.
   */
  readonly defer?: (run: () => void, seconds: number) => void;
}

const laterByTimeout = (run: () => void, seconds: number): void => {
  setTimeout(run, seconds * MS_PER_SECOND);
};

/** A lane that plays: its points, its row and its writer, and its last event's time. */
interface Playing {
  readonly target: AutomationTargetId;
  readonly points: readonly AutomationPoint[];
  readonly row: AutomationTargetRow;
  readonly handle: AutomationHandle;
  last: number;
}

/** A tick the transport issued: its transport tick, song position, time and length, and whether it jumped. */
interface Issued {
  readonly tick: number;
  readonly pos: number;
  readonly time: number;
  readonly interval: number;
  readonly jump: boolean;
}

/** An owner with no lanes, as its envelope tracks read it. */
const NO_LANES: readonly Playing[] = [];
/** The song lanes of an owner registered by its envelopes alone. */
const NO_SONG_LANES: readonly AutomationLane[] = [];

const fold = (tick: number, songTicks: number): number =>
  ((tick % songTicks) + songTicks) % songTicks;

/** An owner's lane list, as the player holds it. */
interface Held {
  readonly owner: AutomationOwner;
  readonly lanes: readonly AutomationLane[];
}

export class AutomationPlayer {
  /** Each owner's lanes, by `ownerKey`. */
  private readonly lanes = new Map<string, Held>();
  private readonly playing = new Map<string, Playing[]>();
  /** Each part's clip envelope tracks, by `ownerKey`; none for a part whose regions play none. */
  private readonly envelopes = new Map<string, ClipEnvelopeTracks>();
  /** The ticks issued since the transport started, from the one sounding now on. */
  private issued: Issued[] = [];
  private lastPos: number | null = null;
  private songTicks: number;
  /** The song position the stopped playhead rests on; fractional after a stop mid-tick. */
  private restPos: number;
  private readonly stepSeconds: number;
  private readonly defer: (run: () => void, seconds: number) => void;
  private readonly unfollow: Unsubscribe;

  constructor(private readonly options: AutomationPlayerOptions) {
    this.songTicks = options.songTicks;
    this.restPos = fold(options.restTick, options.songTicks);
    this.stepSeconds = options.stepSeconds ?? AUTOMATION_STEP_RAMP_SECONDS;
    this.defer = options.defer ?? laterByTimeout;
    this.unfollow = options.transport.subscribe(1, (event) => this.follow(event));
  }

  /** Whether the transport has issued a tick since the last stop or seek. */
  get running(): boolean {
    return this.lastPos !== null;
  }

  /**
   * An owner's whole lane list (a live edit, or its lanes at build): every
   * lane that was on and no longer is gives its target back, and the lanes
   * now on are held where the playhead is and scheduled on from there.
   */
  setLanes(owner: AutomationOwner, lanes: readonly AutomationLane[]): void {
    const key = ownerKey(owner);
    this.lanes.set(key, { owner, lanes });
    this.replay(key, this.options.now());
  }

  /**
   * A part's clip envelopes (windsor#702): what its regions play, or null
   * when none plays one. A running transport restarts the part from now, as
   * a lane edit does; a part without envelopes before or after is untouched.
   * A part the player did not know yet (one added live without
   * `automation`) is registered with no lanes, as `load` registers every
   * part, so a resync, `owners`, a removal, a stop and a dispose reach it
   * as they reach a part with lanes.
   */
  setEnvelopes(owner: AutomationOwner, source: ClipEnvelopeSource | null): void {
    const key = ownerKey(owner);
    let tracks = this.envelopes.get(key);
    if (!source && !tracks) return;
    if (!this.lanes.has(key)) this.lanes.set(key, { owner, lanes: NO_SONG_LANES });
    if (!tracks) {
      const { resolve } = this.options;
      const options = { owner, resolve, stepSeconds: this.stepSeconds, slots: FM_LANES_MAX };
      this.envelopes.set(key, (tracks = new ClipEnvelopeTracks(options)));
    }
    tracks.source = source;
    if (this.running) this.restart(key, this.options.now());
  }

  /** The owners the player knows, lanes or envelopes, in the order they were first set. */
  owners(): readonly AutomationOwner[] {
    return [...this.lanes.values()].map((held) => held.owner);
  }

  /**
   * The voice paths the clip envelopes of the part on `slot` hold a slot
   * for now, written into `out` (cleared first): the envelopes the player
   * has admitted (`ClipEnvelopeTracks.heldPaths`), none for a part with no
   * tracks. The app's env ring reads it each frame (windsor#725), so the
   * part's key is built once per slot and the call allocates nothing.
   */
  envelopeTargets(slot: number, out: string[]): string[] {
    const key = (this.partKeys[slot] ??= ownerKey(partOwner(slot)));
    const tracks = this.envelopes.get(key);
    if (tracks) return tracks.heldPaths(out);
    out.length = 0;
    return out;
  }

  /** Each part's `ownerKey` by slot, for `envelopeTargets`. */
  private readonly partKeys: string[] = [];

  /** The lanes `owner` holds now; none for an owner without lanes. */
  lanesOf(owner: AutomationOwner): readonly AutomationLane[] {
    return this.lanes.get(ownerKey(owner))?.lanes ?? [];
  }

  /**
   * A part or a group leaving the song: its lanes are forgotten, and its
   * strip or bus goes with them, so nothing is given back.
   */
  remove(owner: AutomationOwner): void {
    const key = ownerKey(owner);
    this.lanes.delete(key);
    this.playing.delete(key);
    this.envelopes.delete(key);
  }

  /** The song's length changed (`transport.bars`): positions fold by the new one. */
  setSongTicks(songTicks: number): void {
    this.songTicks = songTicks;
  }

  /**
   * Find every lane's target again and restart it from now: a tempo change,
   * a song-length change, or a part or group whose inserts or patch changed,
   * or whose insert chain was rebuilt (windsor#345). One owner, or every one
   * the player knows: a part's envelope tracks find their targets again
   * with its lanes, whether or not it has any.
   */
  resync(owner?: AutomationOwner): void {
    const now = this.options.now();
    const keys = new Set(this.lanes.keys());
    for (const key of this.envelopes.keys()) keys.add(key);
    for (const key of owner === undefined ? keys : [ownerKey(owner)]) {
      if (keys.has(key)) this.replay(key, now);
    }
  }

  /**
   * The transport stopped: each lane holds its value where the playhead
   * stood, and each clip envelope playing there ramps out from it, its slot
   * given back once the ramp is over.
   */
  stop(): void {
    const now = this.options.now();
    const tick = this.transportAt(now);
    if (this.running) this.restPos = this.positionAt(now);
    this.forget();
    this.holdAll({ tick, ending: true });
    if (this.envelopes.size > 0) this.defer(() => this.sweep(), this.stepSeconds);
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
    this.envelopes.clear();
    this.forget();
  }

  /** Every tick: record it, then schedule its window on every lane. */
  private follow(event: TickEvent): void {
    const pos = fold(event.tick, this.songTicks);
    const jump = this.lastPos === null || pos !== this.lastPos + 1;
    this.lastPos = pos;
    const interval = this.options.transport.intervalSeconds(event.tick);
    const issued: Issued = { tick: event.tick, pos, time: event.time, interval, jump };
    this.issued.push(issued);
    this.prune(this.options.now());
    if (this.envelopes.size === 0) {
      for (const lanes of this.playing.values()) {
        for (const lane of lanes) this.window(lane, issued);
      }
      return;
    }
    // Callbacks made once and a field for the tick, so the envelopes' tick allocates nothing.
    this.sweep();
    this.ticking = issued;
    this.envelopes.forEach(this.tickTracks);
    this.playing.forEach(this.tickLanes);
  }

  /** The tick `follow` is scheduling, for the callbacks below. */
  private ticking: Issued | null = null;

  private readonly tickTracks = (tracks: ClipEnvelopeTracks, key: string): void => {
    tracks.tick(this.ticking!, this.playing.get(key) ?? NO_LANES);
  };

  private readonly tickLanes = (lanes: readonly Playing[], key: string): void => {
    this.windows(lanes, this.ticking!, this.envelopes.get(key));
  };

  /** One tick's windows on `lanes`, but for those a clip envelope's track wrote with its own. */
  private windows(lanes: readonly Playing[], issued: Issued, tracks?: ClipEnvelopeTracks): void {
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]!;
      if (!tracks?.covers(lane.target)) this.window(lane, issued);
    }
  }

  /** Give back the slots whose envelopes have ramped out, and forget the parts done with them. */
  private sweep(): void {
    this.sweeping = this.options.now();
    this.envelopes.forEach(this.sweepTracks);
  }

  /** The time `sweep` gives slots back at, for its callback. */
  private sweeping = 0;

  private readonly sweepTracks = (tracks: ClipEnvelopeTracks, key: string): void => {
    tracks.sweep(this.sweeping, this.playing.get(key) ?? NO_LANES);
    // Deleting the entry being visited is safe in `Map.forEach`.
    if (tracks.idle) this.envelopes.delete(key);
  };

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
        if (lane.row.scale === 'switch') {
          lane.handle.schedule(ramp.value, at, 'set');
          lane.last = at;
        } else if (prev?.tick === ramp.tick) {
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

  /**
   * Resolve one owner's lanes again and restart them from `now`. A handle no
   * lane plays through any more gives its target back first: the lane is
   * off or gone, or its target moved (an insert on a rebuilt or reordered
   * stage) or went unread (windsor#345).
   */
  private replay(key: string, now: number): void {
    const before = this.playing.get(key) ?? [];
    const next = this.resolveOwner(key);
    const tracks = this.envelopes.get(key);
    for (const lane of before) {
      const kept = next.some((p) => p.handle === lane.handle) || tracks?.plays(lane.handle);
      if (!kept) lane.handle.release(now);
    }
    tracks?.refresh(now, next);
    this.restart(key, now);
  }

  /**
   * Hold the owner's lanes at the playhead now and rewind its envelope
   * tracks there, then schedule again every tick issued past now. `at` is a
   * stop's: the transport position it stopped at, and the envelopes end.
   */
  private restart(key: string, now: number, at?: Omit<RewindAt, 'pos'>): void {
    const lanes = this.playing.get(key) ?? NO_LANES;
    const tracks = this.envelopes.get(key);
    const pos = this.running ? this.positionAt(now) : this.restPos;
    for (const lane of lanes) {
      lane.handle.hold(valueAt(lane.row, lane.points, pos), now);
      lane.last = now;
    }
    tracks?.rewind(now, { pos, ...(at ?? { tick: this.transportAt(now), ending: false }) }, lanes);
    for (const issued of this.issued) {
      if (issued.time <= now) continue;
      tracks?.tick(issued, lanes);
      this.windows(lanes, issued, tracks);
    }
  }

  private holdAll(at?: Omit<RewindAt, 'pos'>): void {
    const now = this.options.now();
    for (const key of this.playing.keys()) this.restart(key, now, at);
    for (const key of this.envelopes.keys()) {
      if (!this.playing.has(key)) this.restart(key, now, at);
    }
  }

  /** The owner's lanes that are on and whose target the graph has, resolved now. */
  private resolveOwner(key: string): Playing[] {
    const out: Playing[] = [];
    const { owner, lanes } = this.lanes.get(key) ?? { lanes: [] };
    for (const lane of lanes) {
      if (!owner || !lane.on || lane.points.length === 0 || targetKind(lane.target) === 'seq') {
        continue;
      }
      const resolved = this.options.resolve(owner, lane.target);
      if (resolved) out.push({ target: lane.target, points: lane.points, ...resolved, last: 0 });
    }
    this.playing.set(key, out);
    return out;
  }

  /**
   * The song position sounding at `now`: inside the last issued tick at or
   * before it, by its share of the tick's interval; the first issued tick
   * when none has sounded yet.
   */
  private positionAt(now: number): number {
    const at = this.sounding(now);
    if (!at) return this.issued[0]?.pos ?? this.restPos;
    return at.pos + this.share(at, now);
  }

  /** The transport position sounding at `now`, as `positionAt` reads it; null when no tick has sounded. */
  private transportAt(now: number): number | null {
    const at = this.sounding(now);
    return at ? at.tick + this.share(at, now) : null;
  }

  /** The last issued tick at or before `now`. */
  private sounding(now: number): Issued | undefined {
    let at: Issued | undefined;
    for (const issued of this.issued) {
      if (issued.time > now) break;
      at = issued;
    }
    return at;
  }

  /** How far into `at`'s interval `now` is, 0..1. */
  private share(at: Issued, now: number): number {
    const share = at.interval > 0 ? (now - at.time) / at.interval : 0;
    return Math.min(1, Math.max(0, share));
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
