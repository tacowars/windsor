/**
 * The Song tab's lane edits, kept to what a clip envelope holds (windsor#708
 * decisions 2 and 5; epic windsor#699 decisions 3 and 4), without the DOM.
 * The gestures (`songAutomationGesture.ts`, `songShapeRange.ts`) write a
 * song lane's points; an envelope differs in two ways, and this squares
 * their result with it before it is drawn or written:
 *
 * - **One point to a tick.** An envelope's ticks rise strictly (the
 *   engine's `assertRollEnvelopes`), so a song lane's step, two points on
 *   one tick, can't be kept. Where two meet, the one the gesture wrote wins
 *   over the one it found; a point dragged onto a neighbour's tick stops
 *   one tick short of it while there is room.
 * - **Heard inside the loop.** A point at or past the loop's end is silent
 *   (`envelopeValueAt`), and so is the line that runs to it. A point the
 *   gesture puts on the loop's end (the axis clamps there) is pulled one
 *   tick in, so a Shape or a dragged point that ends there is heard; a Draw
 *   stroke's sample there is dropped, so the stroke stays on the Snap grid.
 *   The silent points a shrunk loop left are kept as they were, unless the
 *   cap needs their room (below).
 *
 * - **At most `ROLL_ENVELOPE_POINTS_MAX` points.** A fine Draw or a fast
 *   cyclic Shape on a long loop can write more than an envelope holds,
 *   and the normaliser would cut the overflow off the end. A gesture inside
 *   the loop always lands (`withinPointCap`): the silent points a shrunk
 *   loop left make room first, furthest past the loop's end first; a heard
 *   point is never dropped for it. Past that, the gesture's own points are
 *   thinned evenly across its range, its first and last kept, until the
 *   whole envelope fits. When the heard points alone fill the cap, an Edit
 *   add has no room at all: the gesture is refused (`settleGesture`), and
 *   the column says so (windsor#724 decision 1).
 *
 * An envelope with no point heard is drawn as its flat 0 line, and the
 * gestures edit that line: `editablePoints` hands them a point at tick 0
 * on 0, which a write keeps.
 */
import type { RollEnvelope, RollEnvelopePoint } from '@windsor/engine';
import { ROLL_ENVELOPE_POINTS_MAX } from '@windsor/engine';
import { ROLL_ENVELOPE_TOOL_UNDO } from './rollEnvelopeTables';

/** The flat 0 line's one point, which the gestures edit on an envelope with none heard. */
export const FLAT_POINT: RollEnvelopePoint = { tick: 0, value: 0, bend: 0 };

/** The points the gestures edit: the envelope's, led by the flat 0 line's point when none is heard in the loop. */
export function editablePoints(
  points: readonly RollEnvelopePoint[],
  loopTicks: number,
): readonly RollEnvelopePoint[] {
  return points.some((point) => point.tick < loopTicks) ? points : [FLAT_POINT, ...points];
}

/** What a gesture started from, and how its result is kept. */
export interface SettleFrame {
  /** The points the gesture started from: what it found, by identity. */
  readonly start: readonly RollEnvelopePoint[];
  readonly loopTicks: number;
  /** A Draw stroke: its sample on the loop's end is dropped, not pulled in. */
  readonly stroke: boolean;
}

/** `next` with what the gesture wrote on or past the loop's end pulled one tick in, or dropped for a stroke. */
function inLoop(next: readonly RollEnvelopePoint[], frame: SettleFrame): RollEnvelopePoint[] {
  const found = new Set(frame.start);
  const end = frame.loopTicks - 1;
  return next.flatMap((point) => {
    if (found.has(point) || point.tick <= end) return [point];
    return frame.stroke ? [] : [{ ...point, tick: end }];
  });
}

/** A point dragged onto a neighbour's tick, stopped one tick short of it where there is room. */
function shortOfNeighbours(
  next: readonly RollEnvelopePoint[],
  start: readonly RollEnvelopePoint[],
): RollEnvelopePoint[] {
  const out = [...next];
  if (next.length !== start.length) return out;
  const moved = next.flatMap((point, i) => (point === start[i] ? [] : [i]));
  const i = moved[0];
  if (moved.length !== 1 || i === undefined) return out;
  const point = next[i]!;
  const lo = (next[i - 1]?.tick ?? -1) + 1;
  const hi = (next[i + 1]?.tick ?? Infinity) - 1;
  if (lo <= hi) out[i] = { ...point, tick: Math.min(hi, Math.max(lo, point.tick)) };
  return out;
}

/** One point to a tick: of two on one tick, the one the gesture wrote, else the later. */
function oneToATick(
  next: readonly RollEnvelopePoint[],
  start: readonly RollEnvelopePoint[],
): RollEnvelopePoint[] {
  const found = new Set(start);
  const out: RollEnvelopePoint[] = [];
  for (const point of next) {
    const last = out[out.length - 1];
    if (!last || point.tick > last.tick) out.push(point);
    else if (point.tick === last.tick && !(found.has(point) && !found.has(last))) {
      out[out.length - 1] = point;
    }
  }
  return out;
}

/** The cap and the loop a gesture's points are kept within. */
export interface PointCap {
  readonly loopTicks: number;
  readonly cap?: number;
}

/**
 * `found` without its `excess` silent points, those furthest past the loop's
 * end first: the points a shrunk loop left, which make room for a gesture.
 */
function droppedSilent(
  found: ReadonlySet<RollEnvelopePoint>,
  excess: number,
  loopTicks: number,
): Set<RollEnvelopePoint> {
  const silent = [...found].filter((point) => point.tick >= loopTicks);
  silent.sort((a, b) => b.tick - a.tick);
  return new Set(silent.slice(0, excess));
}

/** A gesture's points as the envelope keeps them, and whether it was refused. */
export interface SettledGesture {
  readonly points: RollEnvelopePoint[];
  /** The gesture wrote points and the cap kept none of them: the heard points fill it. */
  readonly refused: boolean;
}

/**
 * `next` within the cap: when it holds more, the silent points the gesture
 * found past the loop's end go first, furthest first, so a gesture inside
 * the loop always lands. A heard point it found is never dropped. When the
 * heard points alone pass the cap, the points the gesture wrote (those not
 * in `start`) are thinned evenly by index, their first and last kept, so the
 * gesture still spans its whole range. A gesture with room for fewer than
 * two keeps what fits from its first; one with no room is refused.
 */
export function cappedGesture(
  next: readonly RollEnvelopePoint[],
  start: readonly RollEnvelopePoint[],
  { loopTicks, cap = ROLL_ENVELOPE_POINTS_MAX }: PointCap,
): SettledGesture {
  if (next.length <= cap) return { points: [...next], refused: false };
  const found = new Set(start);
  const dropped = droppedSilent(
    new Set(next.filter((point) => found.has(point))),
    next.length - cap,
    loopTicks,
  );
  const kept = next.filter((point) => !dropped.has(point));
  if (kept.length <= cap) return { points: kept, refused: false };
  const written = kept.filter((point) => !found.has(point));
  const room = Math.max(0, cap - (kept.length - written.length));
  const thinned = new Set<RollEnvelopePoint>();
  if (room === 1) thinned.add(written[0]!);
  for (let i = 0; room > 1 && i < room; i++) {
    thinned.add(written[Math.round((i * (written.length - 1)) / (room - 1))]!);
  }
  const points = kept.filter((point) => found.has(point) || thinned.has(point));
  return { points, refused: room === 0 && written.length > 0 };
}

/** `next` within the cap, as `cappedGesture` keeps it. */
export const withinPointCap = (
  next: readonly RollEnvelopePoint[],
  start: readonly RollEnvelopePoint[],
  cap: PointCap,
): RollEnvelopePoint[] => cappedGesture(next, start, cap).points;

/**
 * A gesture's `next` points as the envelope can hold them: heard inside the
 * loop, one to a tick, within the cap; refused when the cap left it no room.
 */
export function settleGesture(
  next: readonly RollEnvelopePoint[],
  frame: SettleFrame,
): SettledGesture {
  const settled = oneToATick(shortOfNeighbours(inLoop(next, frame), frame.start), frame.start);
  return cappedGesture(settled, frame.start, { loopTicks: frame.loopTicks });
}

/** A gesture's `next` points as the envelope can hold them (`settleGesture`'s points). */
export const settlePoints = (
  next: readonly RollEnvelopePoint[],
  frame: SettleFrame,
): RollEnvelopePoint[] => settleGesture(next, frame).points;

/** `envelopes` with the one on `target` holding `points`. */
export const withEnvelopePoints = (
  envelopes: readonly RollEnvelope[],
  target: string,
  points: readonly RollEnvelopePoint[],
): RollEnvelope[] =>
  envelopes.map((envelope) => (envelope.target === target ? { ...envelope, points } : envelope));

/**
 * The undo step for a lane gesture's `label` on the envelope `name`
 * (decision 7): a Draw names the envelope ("Draw Cutoff envelope"); the
 * Edit tool's keep the Song tab's words ("Move Cutoff point").
 */
export const envelopeUndoLabel = (
  label: string,
  name: string,
  undo = ROLL_ENVELOPE_TOOL_UNDO,
): string => (label === `Draw ${name}` ? undo.draw(name) : label);
