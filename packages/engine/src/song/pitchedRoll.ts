/**
 * A pitched generator's note-on as its part plays it, rolled or not
 * (windsor#366, record `2026-10-01-sequencer-rack-devices` decision 6). A
 * plain note-on is one open hit: one `noteOn`, its extras by `partNoteOn`,
 * exactly as before ratchets. A ratcheted Grid or Arp step's note-on carries
 * a `roll`, whose hits `rollSpan.ts` places across the step's swung span as
 * it places a Euclid roll's, cut where the region ends or the loop jumps:
 *
 * - hit 0 is the note-on as it came, slide and all; each later hit is its
 *   pitch, accent and offsets without the slide;
 * - every hit but an open last one is a fixed note (`trigger`) held `gate`
 *   of its slice, so its note-off precedes the next hit's note-on;
 * - an open last hit is a plain `noteOn`, which the generator releases with
 *   its next note, rest or region end, as it would a plain note.
 *
 * Only the roll's requested final hit is open. When a boundary cuts it off,
 * the last surviving hit keeps its gated hold, so a clipped Arp roll at gate
 * 0.5 sounds nothing where its gate wants silence. At gate 1 that hold runs
 * to the boundary anyway, so there the last surviving hit stays open and the
 * boundary releases it as it releases a plain note: a clipped Grid roll
 * plays like a plain note cut by a region end or a loop jump.
 */
import type { NoteOnEvent, NoteRoll } from '../sequencing/noteEvent';
import type { NoteExtras } from '../synth/audioPart';
import { partNoteOn } from './partNoteOn';
import type { RollHit, RollShape } from './rollSpan';

/** What a roll plays on. `PlayablePart` satisfies it structurally. */
export interface RollTarget {
  noteOn(note: number, velocity?: number, time?: number, extras?: NoteExtras): number;
  trigger(
    note: number,
    velocity?: number,
    duration?: number,
    time?: number,
    extras?: NoteExtras,
  ): number;
}

/** A plain note-on: one hit, on its time, held open. */
export const PLAIN_HIT: readonly RollHit[] = [{ offset: 0, held: Infinity }];

/** The shape `rollHits` places a pitched roll by: no hold of its own, each hit `gate` of its slice. */
export const pitchedRollShape = (roll: NoteRoll): RollShape => ({
  divisor: roll.ticks,
  ratchet: roll.hits,
  hold: Infinity,
  gate: roll.gate,
});

/** Play `event`'s `hits` on `part` over the part's `velocity`. */
export function playPitched(
  part: RollTarget,
  event: NoteOnEvent,
  hits: readonly RollHit[],
  velocity: number,
): void {
  const first = partNoteOn(event, velocity);
  const later = hits.length > 1 ? partNoteOn({ ...event, slide: false }, velocity) : first;
  const openLast = lastHitOpen(event.roll, hits.length);
  hits.forEach(({ offset, held }, j) => {
    const hit = j === 0 ? first : later;
    const time = event.time + offset;
    if (openLast && j === hits.length - 1) part.noteOn(event.note, hit.velocity, time, hit.extras);
    else part.trigger(event.note, hit.velocity, held, time, hit.extras);
  });
}

/** Whether the last of `surviving` hits is held open: the roll's final hit, or any at gate 1. */
function lastHitOpen(roll: NoteRoll | undefined, surviving: number): boolean {
  if (!roll) return true;
  return roll.open && (surviving === roll.hits || roll.gate >= 1);
}
