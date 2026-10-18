/**
 * Duplicate (windsor#904; record `2026-10-18-roll-zoom-bars-and-duplicate`
 * decision 11), without the DOM: the Roll's loop doubled, and everything in
 * it copied one loop later, so the doubled loop plays as the old one played
 * twice.
 *
 * - **Notes.** A note starting inside the old loop gets a copy one loop
 *   length later, with its velocity, accent and ratchet. The performer cuts
 *   a note at the loop's end (`rollSequencer.ts`), so a note running past
 *   the old loop's end is shortened to end there, in both halves.
 * - **Envelopes.** The points inside the old loop get copies one loop
 *   later. Past its last point inside the loop an envelope holds that
 *   point's value, and before its first it reads the first's
 *   (`rollEnvelopeValue.ts`); the wrap then jumps from one to the other. A
 *   point can't step, so where the two values differ the seam gets two
 *   points: one on the old loop's last tick with the last point's value, so
 *   the hold lasts through it, and one on the old loop's end with the first
 *   point's, so the new half opens as the loop did. Either is left out when
 *   a point already sits there. Every tick then reads in both halves what it
 *   read in the old loop.
 * - **Parked.** Notes and points at or past the old loop's end move one loop
 *   later, so they stay parked past the new end.
 *
 * A duplicate is refused (`duplicateRefusal`) when the doubled loop would
 * pass the region or the longest loop, when a parked note or point would
 * move past the longest loop, or when the copies would pass the roll's note
 * cap or an envelope's point cap. The rest of the roll is kept as it is.
 */
import type {
  RollEnvelope,
  RollEnvelopePoint,
  RollNote,
  RollSequencerConfig,
} from '@windsor/engine';
import { ROLL_ENVELOPE_POINTS_MAX, ROLL_LOOP_TICKS_MAX, ROLL_NOTES_MAX } from '@windsor/engine';

/** Why Dup is off: the longest loop, the region, a parked item, the note cap or the point cap. */
export type DuplicateRefusal = 'longest' | 'region' | 'parked' | 'notes' | 'points';

const inside = (tick: number, loop: number): boolean => tick < loop;

/** The points the seam needs between the old loop's points and their copies (above). */
function seamPoints(heard: readonly RollEnvelopePoint[], loop: number): RollEnvelopePoint[] {
  const first = heard[0];
  const last = heard[heard.length - 1];
  if (!first || !last || first.value === last.value) return [];
  const seam: RollEnvelopePoint[] = [];
  if (last.tick < loop - 1) seam.push({ tick: loop - 1, value: last.value, bend: 0 });
  if (first.tick > 0) seam.push({ tick: loop, value: first.value, bend: 0 });
  return seam;
}

/** How many points `envelope` holds once doubled over a loop of `loop`. */
function doubledPointCount(envelope: RollEnvelope, loop: number): number {
  const heard = envelope.points.filter((point) => inside(point.tick, loop));
  return envelope.points.length + heard.length + seamPoints(heard, loop).length;
}

/** Whether something at `tick`, parked at or past `loop`, would move past the longest loop. */
const parkedOverflows = (tick: number, loop: number): boolean =>
  !inside(tick, loop) && tick + loop > ROLL_LOOP_TICKS_MAX - 1;

/** Why `config` can't be doubled inside a region of `regionTicks`, or null when it can. */
export function duplicateRefusal(
  config: RollSequencerConfig,
  regionTicks: number,
): DuplicateRefusal | null {
  const loop = config.loopTicks;
  const envelopes = config.envelopes ?? [];
  if (loop * 2 > ROLL_LOOP_TICKS_MAX) return 'longest';
  if (loop * 2 > regionTicks) return 'region';
  const points = envelopes.flatMap((envelope) => envelope.points);
  if ([...config.notes, ...points].some((item) => parkedOverflows(item.tick, loop))) {
    return 'parked';
  }
  const heardNotes = config.notes.filter((note) => inside(note.tick, loop)).length;
  if (config.notes.length + heardNotes > ROLL_NOTES_MAX) return 'notes';
  if (envelopes.some((envelope) => doubledPointCount(envelope, loop) > ROLL_ENVELOPE_POINTS_MAX)) {
    return 'points';
  }
  return null;
}

/** One envelope's points doubled over a loop of `loop`: the old, the seam, the copies, the parked. */
function doubledPoints(
  points: readonly RollEnvelopePoint[],
  loop: number,
): readonly RollEnvelopePoint[] {
  const heard = points.filter((point) => inside(point.tick, loop));
  const later = (point: RollEnvelopePoint): RollEnvelopePoint => ({
    ...point,
    tick: point.tick + loop,
  });
  const parked = points.filter((point) => !inside(point.tick, loop)).map(later);
  return [...heard, ...seamPoints(heard, loop), ...heard.map(later), ...parked];
}

/**
 * The notes doubled over a loop of `loop`: those inside cut at its end,
 * their copies one loop later, then the parked ones one loop later, each
 * group in the list's own order.
 */
function doubledNotes(notes: readonly RollNote[], loop: number): readonly RollNote[] {
  const heard = notes
    .filter((note) => inside(note.tick, loop))
    .map((note) => (note.tick + note.ticks > loop ? { ...note, ticks: loop - note.tick } : note));
  const later = (note: RollNote): RollNote => ({ ...note, tick: note.tick + loop });
  const parked = notes.filter((note) => !inside(note.tick, loop)).map(later);
  return [...heard, ...heard.map(later), ...parked];
}

/**
 * `config` with its loop doubled and everything in it copied into the new
 * half (above), or null when `duplicateRefusal` refuses it. Every other
 * field is kept.
 */
export function duplicateLoop(
  config: RollSequencerConfig,
  regionTicks: number,
): RollSequencerConfig | null {
  if (duplicateRefusal(config, regionTicks) !== null) return null;
  const loop = config.loopTicks;
  const next: RollSequencerConfig = {
    ...config,
    loopTicks: loop * 2,
    notes: doubledNotes(config.notes, loop),
  };
  if (!config.envelopes) return next;
  const envelopes = config.envelopes.map((envelope) => ({
    ...envelope,
    points: doubledPoints(envelope.points, loop),
  }));
  return { ...next, envelopes };
}

/**
 * Where the notes at `selected` sit in `duplicateLoop`'s list: a note inside
 * the loop keeps its place among those inside, and a parked one follows the
 * copies. The copies themselves are not selected.
 */
export function duplicatedSelection(
  notes: readonly RollNote[],
  loop: number,
  selected: readonly number[],
): number[] {
  const at = new Map<number, number>();
  let heard = 0;
  notes.forEach((note, i) => {
    if (inside(note.tick, loop)) at.set(i, heard++);
  });
  let parked = 0;
  notes.forEach((note, i) => {
    if (!inside(note.tick, loop)) at.set(i, heard * 2 + parked++);
  });
  return selected.flatMap((i) => {
    const next = at.get(i);
    return next === undefined ? [] : [next];
  });
}
