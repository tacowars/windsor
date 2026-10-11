/**
 * One part's clip envelopes on its voice slots (windsor#702, epic
 * windsor#699 decisions 2 and 5–8): the automation player hands each tick it
 * schedules to the part's tracks before its lanes, and a track writes its
 * target's slot for that tick, the song lane's offset on the same target
 * plus the envelope's, through the one handle the part keeps per target
 * (`synth/voiceAutomation.ts`).
 *
 * - **The offset.** An envelope value `v` (−1..1) is `v × span` in the
 *   target row's own curve (`worklet/fm/voiceTargetTables.ts`), as a step
 *   lane's is. A lane's value is the offset its handle writes for it
 *   (`OffsetHandle.offsetOf`), so with a lane the slot carries the sum, and
 *   a target with no envelope playing is left to its lane as before.
 * - **Each tick.** The envelope is read at the region's loop tick
 *   (`clipEnvelopeSource.ts`) and ramped to at the tick's time, as a lane's
 *   breakpoint is; its points inside the tick and the lane's breakpoints
 *   there are ramped to in time order (`clipEnvelopeWindow.ts`).
 * - **Discontinuities.** The loop's wrap, a new region pass, the envelope
 *   starting and the envelope ending are steps: a ramp to the value before,
 *   then over the player's step de-click to the value after, which a held
 *   note hears. A tick the transport jumped to (a start, a seek, the
 *   transport loop) holds the sum there, as lanes do. A stop cancels what
 *   every track has queued, however far the look-ahead ran, and ramps an
 *   envelope sounding at the playhead out from there over the same de-click.
 * - **Slots.** A track takes its target's slot when its envelope first
 *   plays and keeps it while it plays. Once it ends, its offset ramps to 0,
 *   or to the lane's, and the slot is given back once that ramp is over
 *   (`sweep`), unless a lane holds the target. A new target is admitted only
 *   while the part's voice lanes and its other tracks leave a slot free; a
 *   song lane's target is always admitted and shares its slot. One not
 *   admitted is skipped, and asked about again next tick; nothing throws. A
 *   target the patch maps from a macro has no handle and stays silent
 *   (windsor#560) until `refresh`.
 *
 * `tick` and `sweep` allocate nothing of their own, except the first tick
 * of a target and the slot given back; with a lane on the target the window
 * reads the lane's `rampsBetween`, as the lane's own window would.
 * `clipEnvelopePlayer.test.ts`.
 */
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { VOICE_TARGET_SPAN, voiceTargetCode } from '../worklet/fm/voiceTargetTables';
import { valueAt } from './automationEvaluate';
import type { AutomationHandle } from './automationHandles';
import { isOffsetHandle } from './automationHandles';
import type { AutomationOwner } from './automationOwner';
import type { AutomationResolver } from './automationPlayer';
import { VOICE_PREFIX, voiceTargetId } from './automationTargets';
import type { ClipEnvelopeSource } from './clipEnvelopeSource';
import { emptyClipEnvelopeFrame, envelopePlays } from './clipEnvelopeSource';
import type { PlayingLane, Track, TrackTick } from './clipEnvelopeWindow';
import { EnvelopeWindow, envelopeOffset } from './clipEnvelopeWindow';

export interface ClipEnvelopeTrackOptions {
  readonly owner: AutomationOwner;
  readonly resolve: AutomationResolver;
  /** The de-click on a step, and the ramp out at an end. */
  readonly stepSeconds: number;
  /** The part's voice slots: `FM_LANES_MAX`. */
  readonly slots: number;
}

/** Where a rewind finds the playhead. */
export interface RewindAt {
  /** The song position: where the lanes are read. */
  readonly pos: number;
  /** The transport position, fractional; null when no tick sounds (stopped, or not yet started). */
  readonly tick: number | null;
  /** A stop: a playing envelope ramps out from the playhead rather than holding. */
  readonly ending: boolean;
}

/** Whether lane target `target` is the voice target at `path`, without building its id. */
const isTargetOf = (target: string, path: string): boolean =>
  target.length === VOICE_PREFIX.length + path.length &&
  target.startsWith(VOICE_PREFIX) &&
  target.endsWith(path);

/** The lane playing `target` among `lanes`, if any. */
function laneOn(lanes: readonly PlayingLane[], target: string): PlayingLane | undefined {
  for (let i = 0; i < lanes.length; i++) if (lanes[i]!.target === target) return lanes[i];
  return undefined;
}

/** Whether a lane writes through `handle`. */
function laneHolds(lanes: readonly PlayingLane[], handle: AutomationHandle): boolean {
  for (let i = 0; i < lanes.length; i++) if (lanes[i]!.handle === handle) return true;
  return false;
}

export class ClipEnvelopeTracks {
  source: ClipEnvelopeSource | null = null;
  private readonly tracks: Track[] = [];
  private readonly frame = emptyClipEnvelopeFrame();
  /** Targets found with no handle (a macro maps them), not resolved again until `refresh`. */
  private readonly refused = new Set<string>();
  private readonly window: EnvelopeWindow;

  constructor(private readonly options: ClipEnvelopeTrackOptions) {
    this.window = new EnvelopeWindow(options.stepSeconds);
  }

  /** Nothing to play and no slot held: the player may forget the part's tracks. */
  get idle(): boolean {
    return this.source === null && this.tracks.length === 0;
  }

  /** Whether a track wrote `target`'s slot for the tick just written, its lane's window with it. */
  covers(target: string): boolean {
    const { tracks } = this;
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i]!.covered && tracks[i]!.target === target) return true;
    }
    return false;
  }

  /**
   * Whether a playing track writes through `handle`: a lane leaving it
   * keeps the slot, and the track's rewind writes it without the lane. A
   * draining track's slot goes with the lane.
   */
  plays(handle: AutomationHandle): boolean {
    return this.tracks.some((track) => track.live && track.handle === handle);
  }

  /** One tick: each envelope the region plays there, and an end for each it no longer does. */
  tick(issued: TrackTick, lanes: readonly PlayingLane[]): void {
    const { frame, tracks } = this;
    for (let i = 0; i < tracks.length; i++) tracks[i]!.covered = false;
    if (this.source?.frameAt(issued.tick, frame)) {
      const { envelopes } = frame;
      for (let i = 0; i < envelopes.length; i++) {
        const envelope = envelopes[i]!;
        if (!envelopePlays(envelope)) continue;
        const track = this.find(envelope.target) ?? this.admit(envelope.target, lanes);
        if (!track) continue;
        this.window.write(track, envelope, frame, issued, laneOn(lanes, track.target));
        track.covered = true;
      }
    }
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      if (!track.live || track.covered) continue;
      const lane = laneOn(lanes, track.target);
      this.window.write(track, null, frame, issued, lane);
      track.covered = true;
      if (!lane) track.drainAt = track.last;
    }
  }

  /**
   * Restart every track from `now`, after the lanes have held there: the
   * sum at the playhead, the envelope read at its transport position. Any
   * other track, or every track at a stop, ends: from the sum, its offset
   * ramps to the lane's or to 0, and its slot is given back after. That is
   * every track, `live` or not: the look-ahead may have queued a short
   * region's whole pass and its end past `now`, so `live` reads the last
   * queued tick, not what sounds, and the hold is what cancels those events.
   */
  rewind(now: number, at: RewindAt, lanes: readonly PlayingLane[]): void {
    for (const track of this.tracks) {
      const lane = laneOn(lanes, track.target);
      const laneOffset = lane ? track.handle.offsetOf(valueAt(lane.row, lane.points, at.pos)) : 0;
      const envelope = at.tick === null ? null : this.envelopeAt(track, Math.floor(at.tick));
      const { loopTick, loopTicks } = this.frame;
      const offset =
        envelope && at.tick !== null
          ? envelopeOffset(track, envelope, loopTick + (at.tick % 1), loopTicks)
          : 0;
      if (envelope && !at.ending) {
        track.handle.holdOffset(laneOffset + offset, now);
        this.window.on(track).settle(envelope, this.frame, now);
        if (lane) lane.last = now;
      } else {
        track.handle.holdOffset(laneOffset + offset, now);
        const end = offset === 0 ? now : now + this.options.stepSeconds;
        if (end > now) track.handle.scheduleOffset(laneOffset, end, 'ramp');
        track.live = false;
        track.last = end;
        track.drainAt = end;
        if (lane) lane.last = end;
      }
    }
  }

  /** Give back each slot whose offset has drained to 0 by `now`, unless a lane holds it. */
  sweep(now: number, lanes: readonly PlayingLane[]): void {
    const { tracks } = this;
    for (let i = tracks.length - 1; i >= 0; i--) {
      const track = tracks[i]!;
      if (track.live || !(track.drainAt <= now)) continue;
      if (!laneHolds(lanes, track.handle)) track.handle.release(now);
      tracks.splice(i, 1);
    }
  }

  /**
   * Find every target again (a patch edit, a lane edit, an insert re-wired):
   * a track whose handle went (a macro now maps it) or changed gives its
   * slot back, and so do tracks past the slots the lanes leave, so the
   * song's lanes keep theirs.
   */
  refresh(now: number, lanes: readonly PlayingLane[]): void {
    this.refused.clear();
    const { owner, resolve, slots } = this.options;
    let free = slots - lanes.filter((lane) => isOffsetHandle(lane.handle)).length;
    const { tracks } = this;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      const shared = laneOn(lanes, track.target) !== undefined;
      const found = resolve(owner, voiceTargetId(track.path))?.handle;
      if (found === track.handle && (shared || free-- > 0)) continue;
      if (!laneHolds(lanes, track.handle)) track.handle.release(now);
      tracks.splice(i--, 1);
    }
  }

  /** The envelope on `track`'s target the region plays at transport tick `tick`, filling the frame. */
  private envelopeAt(track: Track, tick: number): RollEnvelope | null {
    if (!this.source?.frameAt(tick, this.frame)) return null;
    for (const envelope of this.frame.envelopes) {
      if (envelope.target === track.path && envelopePlays(envelope)) return envelope;
    }
    return null;
  }

  private find(path: string): Track | undefined {
    const { tracks } = this;
    for (let i = 0; i < tracks.length; i++) if (tracks[i]!.path === path) return tracks[i];
    return undefined;
  }

  /** A track for `path`, its first tick: when its lane shares a slot, or a slot is free. */
  private admit(path: string, lanes: readonly PlayingLane[]): Track | undefined {
    if (this.refused.has(path)) return undefined;
    let shared = false;
    let used = 0;
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[i]!;
      if (isTargetOf(lane.target, path)) shared = true;
      if (isOffsetHandle(lane.handle)) used++;
    }
    for (let i = 0; i < this.tracks.length; i++) {
      if (!laneOn(lanes, this.tracks[i]!.target)) used++;
    }
    if (!shared && used >= this.options.slots) return undefined;
    const target = voiceTargetId(path);
    const handle = this.options.resolve(this.options.owner, target)?.handle;
    if (!handle || !isOffsetHandle(handle)) {
      this.refused.add(path);
      return undefined;
    }
    const track: Track = {
      path,
      target,
      handle,
      span: VOICE_TARGET_SPAN[voiceTargetCode(path)] ?? 0,
      live: false,
      covered: false,
      entryTick: 0,
      localTick: 0,
      endOffset: 0,
      last: 0,
      drainAt: NaN,
    };
    this.tracks.push(track);
    return track;
  }
}
