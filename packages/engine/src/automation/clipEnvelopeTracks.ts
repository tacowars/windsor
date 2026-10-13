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
 *   song lane's target is always admitted and shares its slot, in the
 *   roll's order (`admittedEnvelopes`, `clipEnvelopeAdmission.ts`). What
 *   the tracks hold is read back by `heldPaths`, for the app's env ring.
 *   One not admitted is skipped, and asked
 *   about again next tick; nothing throws.
 * - **Only what can sound** (windsor#718). An envelope is admitted only
 *   when it can change the sound (`envelopeSounds`): it plays, and its
 *   target has a handle (no macro of the patch maps it, windsor#560) on a
 *   value the patch has (a macro past the patch's count has none). A
 *   target that fails stays silent, and takes no slot, until `refresh`
 *   runs the rule again; there the slots the lanes leave go to the
 *   envelopes in the roll's order, so one the patch can now move takes its
 *   place ahead of those after it.
 * - **Exact zero** (windsor#718). An envelope's 0 is the patch's own value.
 *   With no lane on its target a track's slot is `relative`, so the worklet
 *   floors nothing there: a decay time or LFO rate of exactly 0 stays 0
 *   under an envelope at 0. With a lane the slot is the lane's, absolute,
 *   floored as a lane's is (windsor#347).
 * - **Performance values** (windsor#781, record `2026-10-13-midi-cc-mapping`
 *   decisions 3 and 8). A MIDI CC's value held on a voice target
 *   (`partPerformance.ts`) rides under the envelope where no lane plays the
 *   target: the slot carries its offset plus the envelope's, absolute, as
 *   with a lane, and an envelope's end ramps back to it. The value keeps
 *   the slot when the track gives it back. It counts after the lanes and
 *   before the envelopes, in admission and in `refresh`. The player writes
 *   a track again from now when the value under it moves (`only`).
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
import { voiceTargetId } from './automationTargets';
import type { EnvelopeAdmissionQuery } from './clipEnvelopeAdmission';
import { admittedEnvelopes, isVoiceTargetOf } from './clipEnvelopeAdmission';
import type { ClipEnvelopeSource } from './clipEnvelopeSource';
import {
  emptyClipEnvelopeFrame,
  envelopePlays,
  envelopeSounds,
  targetSounds,
} from './clipEnvelopeSource';
import type { PlayingLane, Track, TrackTick } from './clipEnvelopeWindow';
import { EnvelopeWindow, envelopeOffset } from './clipEnvelopeWindow';
import type { PartPerformance } from './partPerformance';

export interface ClipEnvelopeTrackOptions {
  readonly owner: AutomationOwner;
  readonly resolve: AutomationResolver;
  /** The de-click on a step, and the ramp out at an end. */
  readonly stepSeconds: number;
  /** The part's voice slots: `FM_LANES_MAX`. */
  readonly slots: number;
  /** The part's performance values (windsor#781), read for the offset under each track. */
  readonly performance: PartPerformance;
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

/** The lane playing `target` among `lanes`, if any. */
function laneOn(lanes: readonly PlayingLane[], target: string): PlayingLane | undefined {
  for (let i = 0; i < lanes.length; i++) if (lanes[i]!.target === target) return lanes[i];
  return undefined;
}

/** Whether a tick or rewind for the track on `only`, a lane target id, passes the one on `target` by. */
const skips = (only: string | undefined, target: string): boolean =>
  only !== undefined && only !== target;

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
  /** `admit`'s question and answer, refilled per call. */
  private readonly admission: EnvelopeAdmissionQuery;
  private readonly admitted: string[] = [];

  constructor(private readonly options: ClipEnvelopeTrackOptions) {
    this.window = new EnvelopeWindow(options.stepSeconds);
    this.admission = {
      lanes: [],
      held: this.tracks,
      performed: options.performance.voices,
      envelopes: [],
      loopTicks: 1,
      slots: options.slots,
      sounds: this.sounds,
    };
  }

  /** Nothing to play and no slot held: the player may forget the part's tracks. */
  get idle(): boolean {
    return this.source === null && this.tracks.length === 0;
  }

  /** Whether a track holds `target`'s slot, playing or ramping out: it writes that slot. */
  tracking(target: string): boolean {
    const { tracks } = this;
    for (let i = 0; i < tracks.length; i++) if (tracks[i]!.target === target) return true;
    return false;
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
   * The voice paths this part's tracks hold a slot for now, written into
   * `out` (cleared first): the envelopes the engine has admitted, which the
   * app's env ring reads while the transport plays (windsor#725), so it
   * never works admission out again. Allocates nothing past `out`'s growth.
   */
  heldPaths(out: string[]): string[] {
    const { tracks } = this;
    out.length = 0;
    for (let i = 0; i < tracks.length; i++) out.push(tracks[i]!.path);
    return out;
  }

  /**
   * Whether a playing track writes through `handle`: a lane leaving it
   * keeps the slot, and the track's rewind writes it without the lane. A
   * draining track's slot goes with the lane.
   */
  plays(handle: AutomationHandle): boolean {
    return this.tracks.some((track) => track.live && track.handle === handle);
  }

  /**
   * One tick: each envelope the region plays there, and an end for each it
   * no longer does; with `only`, the track on that lane target id alone.
   */
  tick(issued: TrackTick, lanes: readonly PlayingLane[], only?: string): void {
    const { frame, tracks } = this;
    for (let i = 0; i < tracks.length; i++) {
      if (!skips(only, tracks[i]!.target)) tracks[i]!.covered = false;
    }
    if (this.source?.frameAt(issued.tick, frame)) {
      const { envelopes } = frame;
      for (let i = 0; i < envelopes.length; i++) {
        const envelope = envelopes[i]!;
        if (!envelopePlays(envelope, frame.loopTicks)) continue;
        if (only !== undefined && !isVoiceTargetOf(only, envelope.target)) continue;
        const track = this.find(envelope.target) ?? this.admit(envelope, lanes);
        if (!track) continue;
        this.window.write(this.based(track), envelope, frame, issued, laneOn(lanes, track.target));
        track.covered = true;
      }
    }
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      if (!track.live || track.covered || skips(only, track.target)) continue;
      const lane = laneOn(lanes, track.target);
      this.window.write(this.based(track), null, frame, issued, lane);
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
  rewind(now: number, at: RewindAt, lanes: readonly PlayingLane[], only?: string): void {
    for (const track of this.tracks) {
      if (skips(only, track.target)) continue;
      const lane = laneOn(lanes, track.target);
      const { base } = this.based(track);
      const laneOffset = lane
        ? track.handle.offsetOf(valueAt(lane.row, lane.points, at.pos))
        : base;
      const envelope = at.tick === null ? null : this.envelopeAt(track, Math.floor(at.tick));
      const { loopTick, loopTicks } = this.frame;
      const offset =
        envelope && at.tick !== null
          ? envelopeOffset(track, envelope, loopTick + (at.tick % 1), loopTicks)
          : 0;
      track.handle.setRelative(lane === undefined && !track.performed);
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

  /** Give back each slot whose offset has drained by `now`, unless a lane or a performance value holds it. */
  sweep(now: number, lanes: readonly PlayingLane[]): void {
    const { tracks } = this;
    for (let i = tracks.length - 1; i >= 0; i--) {
      const track = tracks[i]!;
      if (track.live || !(track.drainAt <= now)) continue;
      this.giveBack(track, now, lanes);
      tracks.splice(i, 1);
    }
  }

  /**
   * A track leaves its slot: to the lane on its target, which goes on
   * writing it; else to the performance value there, held at its offset;
   * else back to the part.
   */
  private giveBack(track: Track, now: number, lanes: readonly PlayingLane[]): void {
    if (laneHolds(lanes, track.handle)) return;
    const offset = this.options.performance.offsetOn(track.target);
    if (offset === undefined) {
      track.handle.release(now);
      return;
    }
    track.handle.setRelative(false);
    track.handle.holdOffset(offset, now);
  }

  /** `track` with the performance value under it read now (windsor#781). Allocates nothing. */
  private based(track: Track): Track {
    const offset = this.options.performance.offsetOn(track.target);
    track.performed = offset !== undefined;
    track.base = offset ?? 0;
    return track;
  }

  /**
   * Find every target again (a patch edit, a preset switch, a lane edit, an
   * insert re-wired) and run `envelopeSounds` again (windsor#718): a track
   * whose target no longer sounds (a macro now maps it, or the patch has no
   * such macro) or whose handle changed gives its slot back. The slots the
   * lanes leave go to the envelopes the region of the last tick plays, in
   * the roll's order, then to any other track (one ramping out); a track
   * past them gives its slot back, so the song's lanes keep theirs. An
   * envelope with no track yet keeps its place, and the next tick admits it.
   */
  refresh(now: number, lanes: readonly PlayingLane[]): void {
    this.refused.clear();
    const { owner, resolve, slots, performance } = this.options;
    const { envelopes, loopTicks } = this.frame;
    // The lanes keep their slots first, then the performance values (windsor#781).
    const performed = performance.voices.filter((held) => !laneOn(lanes, held.target));
    let free =
      slots - lanes.filter((lane) => isOffsetHandle(lane.handle)).length - performed.length;
    const kept = new Set<Track>();
    /** Whether `target` has a slot: its lane's, a performance value's, or one still free, which it takes. */
    const room = (target: string): boolean => {
      if (laneOn(lanes, target) || performance.offsetOn(target) !== undefined) return true;
      if (free <= 0) return false;
      free--;
      return true;
    };
    const ordered = new Set<string>();
    for (const envelope of envelopes) {
      if (!envelopePlays(envelope, loopTicks)) continue;
      ordered.add(envelope.target);
      const target = voiceTargetId(envelope.target);
      const handle = resolve(owner, target)?.handle;
      if (!envelopeSounds(envelope, loopTicks, handle) || !room(target)) continue;
      // A track on a handle that changed goes; the next tick admits the new one here.
      const track = this.find(envelope.target);
      if (track?.handle === handle) kept.add(track);
    }
    for (const track of this.tracks) {
      if (ordered.has(track.path)) continue;
      const found = resolve(owner, voiceTargetId(track.path))?.handle;
      if (found === track.handle && targetSounds(found) && room(track.target)) kept.add(track);
    }
    const { tracks } = this;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      if (kept.has(track)) continue;
      this.giveBack(track, now, lanes);
      tracks.splice(i--, 1);
    }
  }

  /** The envelope on `track`'s target the region plays at transport tick `tick`, filling the frame. */
  private envelopeAt(track: Track, tick: number): RollEnvelope | null {
    if (!this.source?.frameAt(tick, this.frame)) return null;
    for (const envelope of this.frame.envelopes) {
      if (envelope.target === track.path && envelopePlays(envelope, this.frame.loopTicks)) {
        return envelope;
      }
    }
    return null;
  }

  private find(path: string): Track | undefined {
    const { tracks } = this;
    for (let i = 0; i < tracks.length; i++) if (tracks[i]!.path === path) return tracks[i];
    return undefined;
  }

  /**
   * A track for `envelope`, its first tick: when `admittedEnvelopes`, the
   * one admission order, admits it among the frame's envelopes, over the
   * lanes and the tracks there are now.
   */
  private admit(envelope: RollEnvelope, lanes: readonly PlayingLane[]): Track | undefined {
    const path = envelope.target;
    if (this.refused.has(path)) return undefined;
    const { admission } = this;
    admission.lanes = lanes;
    admission.envelopes = this.frame.envelopes;
    admission.loopTicks = this.frame.loopTicks;
    if (!admittedEnvelopes(admission, this.admitted).includes(path)) return undefined;
    const target = voiceTargetId(path);
    const handle = this.options.resolve(this.options.owner, target)?.handle;
    if (!targetSounds(handle)) return undefined;
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
      base: 0,
      performed: false,
    };
    this.tracks.push(track);
    return track;
  }

  /**
   * Whether `path`'s target sounds, asked by `admittedEnvelopes` once a
   * slot is there for it (windsor#718); one that does not is refused, not
   * resolved again until `refresh`.
   */
  private readonly sounds = (path: string): boolean => {
    if (this.refused.has(path)) return false;
    const { owner, resolve } = this.options;
    if (targetSounds(resolve(owner, voiceTargetId(path))?.handle)) return true;
    this.refused.add(path);
    return false;
  };
}
