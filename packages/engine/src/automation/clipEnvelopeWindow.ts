/**
 * One tick of one clip envelope on its voice slot (windsor#702): the events
 * `ClipEnvelopeTracks` writes for a track, the song lane on the same target
 * summed in. See `clipEnvelopeTracks.ts` for the rules; this is their
 * arithmetic.
 *
 * The tick's window is `[pos, pos + 1)` in song position, the envelope's
 * `[loopTick, loopTick + 1)` in loop position. At `pos` the sum is ramped to,
 * or stepped to where the lane steps or the envelope does not carry on from
 * the tick before (a wrap, a new region pass, a start, an end). Then each of
 * the lane's breakpoints and the envelope's points inside the window, in
 * order, is ramped to as the sum there, a lane's step stepped. The window
 * keeps its working state in fields, so writing one allocates nothing.
 */
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { envelopeValueAt } from '../sequencing/rollEnvelopeValue';
import type { AutomationRamp } from './automationEvaluate';
import { firstPointPast, rampsBetween, valueAt } from './automationEvaluate';
import type { AutomationHandle, OffsetHandle } from './automationHandles';
import type { AutomationPoint, AutomationTargetRow } from './automationLane';
import type { ClipEnvelopeFrame } from './clipEnvelopeSource';

/** A lane the player plays, as a track reads it: `AutomationPlayer`'s own. */
export interface PlayingLane {
  readonly target: string;
  readonly points: readonly AutomationPoint[];
  readonly row: AutomationTargetRow;
  readonly handle: AutomationHandle;
  /** Its last event's time; a track writing the lane's slot moves it on. */
  last: number;
}

/** A tick the transport issued, as a track reads it. */
export interface TrackTick {
  /** The transport tick: where the region and its loop are read. */
  readonly tick: number;
  /** The song position: where the lane is read. */
  readonly pos: number;
  readonly time: number;
  readonly interval: number;
  /** Whether the transport jumped to it: a start, a seek, the loop. */
  readonly jump: boolean;
}

/** One envelope target on a part: its slot's handle, and where its last tick left it. */
export interface Track {
  /** The voice target's patch path, as the envelope names it. */
  readonly path: string;
  /** Its lane target id, `voice.<path>`. */
  readonly target: string;
  readonly handle: OffsetHandle;
  /** The row's span: an envelope value of 1 is this offset. */
  readonly span: number;
  /** Whether the last tick written played the envelope. */
  live: boolean;
  /** Whether the tick being written is this track's, its lane's window included. */
  covered: boolean;
  /** The region pass and the local tick of the last tick played. */
  entryTick: number;
  localTick: number;
  /** The envelope's offset at the end of the last tick played: where a step leaves from. */
  endOffset: number;
  /** Its last event's time. */
  last: number;
  /** When its offset is back at 0 after an end, until the slot is given back; NaN otherwise. */
  drainAt: number;
}

/** A track's envelope offset at loop position `at`, read inside `loopTicks`. */
export const envelopeOffset = (
  track: Track,
  envelope: RollEnvelope,
  at: number,
  loopTicks: number,
): number => track.span * envelopeValueAt(envelope, at, loopTicks);

/** Writes tracks' ticks; one per part, reused tick after tick. */
export class EnvelopeWindow {
  private track!: Track;
  private envelope: RollEnvelope | null = null;
  private frame!: ClipEnvelopeFrame;
  private issued!: TrackTick;
  private lane: PlayingLane | undefined;
  private ramps: readonly AutomationRamp[] | null = null;
  private last = 0;

  constructor(private readonly stepSeconds: number) {}

  /**
   * Write `track`'s tick `issued`: `envelope` played at `frame`'s loop tick,
   * or, null, its end, the offset going back to the lane's or to 0.
   */
  write(
    track: Track,
    envelope: RollEnvelope | null,
    frame: ClipEnvelopeFrame,
    issued: TrackTick,
    lane: PlayingLane | undefined,
  ): void {
    this.track = track;
    this.envelope = envelope;
    this.frame = frame;
    this.issued = issued;
    this.lane = lane;
    const { pos } = issued;
    this.ramps = lane
      ? rampsBetween(lane.row, lane.points, { fromTick: pos, toTick: pos + 1 })
      : null;
    this.last = lane ? lane.last : track.last;
    // An envelope's 0 is the patch's own value; a lane's slot is the lane's (windsor#718).
    track.handle.setRelative(lane === undefined);
    this.start();
    this.inside();
    if (envelope) this.settle(envelope, frame, this.last);
    else {
      track.live = false;
      track.endOffset = 0;
      track.last = this.last;
    }
    if (lane) lane.last = this.last;
  }

  /** `track` plays `envelope` at `frame` as of `time`: where a rewind's hold leaves it. */
  settle(envelope: RollEnvelope, frame: ClipEnvelopeFrame, time: number): void {
    const { track } = this;
    track.live = true;
    track.entryTick = frame.entryTick;
    track.localTick = frame.localTick;
    track.endOffset = envelopeOffset(track, envelope, frame.loopTick + 1, frame.loopTicks);
    track.last = time;
    track.drainAt = NaN;
  }

  /** Point the window at `track`, for a `settle` outside a `write`. */
  on(track: Track): this {
    this.track = track;
    return this;
  }

  /** The sum at `pos`: a hold after a jump, a step where either side breaks, else a ramp. */
  private start(): void {
    const { track, envelope, frame, issued, lane, ramps } = this;
    const { handle } = track;
    const { pos, time } = issued;
    const carries =
      envelope !== null &&
      track.live &&
      track.entryTick === frame.entryTick &&
      track.localTick + 1 === frame.localTick &&
      frame.loopTick !== 0;
    const now = envelope ? envelopeOffset(track, envelope, frame.loopTick, frame.loopTicks) : 0;
    const before = carries ? now : track.live ? track.endOffset : 0;
    let laneBefore = 0;
    let laneAfter = 0;
    if (lane && ramps) {
      laneAfter = handle.offsetOf(valueAt(lane.row, lane.points, pos));
      const stepsHere = ramps.length > 1 && ramps[0]!.tick === pos && ramps[1]!.tick === pos;
      laneBefore = stepsHere ? handle.offsetOf(ramps[0]!.value) : laneAfter;
    }
    if (issued.jump) {
      handle.holdOffset(laneAfter + now, time);
      this.last = time;
    } else {
      this.step(laneBefore + before, laneAfter + now, Math.max(this.last, time));
    }
  }

  /** The lane's breakpoints and the envelope's points after `pos` inside the window, in order. */
  private inside(): void {
    const { track, envelope, frame, issued, lane, ramps } = this;
    const { handle } = track;
    const { pos, time, interval } = issued;
    const points = envelope?.points;
    let i = 0;
    while (ramps && i < ramps.length && ramps[i]!.tick === pos) i++;
    let j = points ? firstPointPast(points, frame.loopTick, true) : 0;
    for (;;) {
      const laneQ = ramps && i < ramps.length ? ramps[i]!.tick - pos : Infinity;
      const point = points?.[j];
      const envelopeQ =
        point && point.tick < frame.loopTick + 1 ? point.tick - frame.loopTick : Infinity;
      const q = laneQ < envelopeQ ? laneQ : envelopeQ;
      if (q === Infinity) return;
      let before = 0;
      let after = 0;
      if (laneQ === q && ramps) {
        before = handle.offsetOf(ramps[i]!.value);
        while (i + 1 < ramps.length && ramps[i + 1]!.tick === ramps[i]!.tick) i++;
        after = handle.offsetOf(ramps[i++]!.value);
      } else if (lane) {
        before = after = handle.offsetOf(valueAt(lane.row, lane.points, pos + q));
      }
      if (envelopeQ === q) j++;
      const offset = envelope
        ? envelopeOffset(track, envelope, frame.loopTick + q, frame.loopTicks)
        : 0;
      this.step(before + offset, after + offset, Math.max(this.last, time + q * interval));
    }
  }

  /** `before` then `after` at `at`: one ramp when they agree, else a step over the de-click. */
  private step(before: number, after: number, at: number): void {
    const { handle } = this.track;
    if (before === after) {
      handle.scheduleOffset(after, at, 'ramp');
      this.last = at;
      return;
    }
    handle.scheduleOffset(before, at, 'ramp');
    handle.scheduleOffset(after, at + this.stepSeconds, 'ramp');
    this.last = at + this.stepSeconds;
  }
}
