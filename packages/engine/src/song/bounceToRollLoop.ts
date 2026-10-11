/**
 * Bounce to Roll's loop search (windsor#741, record
 * `2026-10-11-bounce-to-roll` decision 5): the fewest whole bars of the
 * song's meter, counted from the region's start, whose notes and envelopes
 * play the rendered region exactly when the Roll's performer loops them.
 *
 * A candidate loop of `L` ticks, shorter than the region, keeps the
 * rendered notes with an onset before `L`, each cut to `min(ticks, L −
 * tick)` as the performer cuts it. Repeated at 0, L, 2L, … and each copy
 * cut at the region's end (a partial last repeat is a prefix), they must
 * give exactly the rendered notes: pitch, onset, length, and the velocity
 * the part played (and the event's own, which a part at Vel 0 writes). Its
 * envelopes must read the rendered envelope's value at every onset. A
 * region no candidate fits is unrolled: its loop is its own length.
 *
 * Pure. An empty region is the bounce's to size, not this search's.
 */
import { BOUNCE_ENVELOPE_STEP_TICKS } from './bounceRenderTables';
import type { BounceNote, BounceRegion } from './bounceRenderTypes';
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { envelopeValueAt } from '../sequencing/rollEnvelopeValue';

/** A region's loop: its length, and the notes and envelopes it holds. */
export interface BounceLoop {
  readonly loopTicks: number;
  /** The rendered notes the loop keeps, each cut at its end; sorted as rendered. */
  readonly notes: readonly BounceNote[];
  readonly envelopes: readonly RollEnvelope[];
}

/** The notes with an onset before `loopTicks`, each cut at the loop's end as the performer cuts it. */
function loopNotes(notes: readonly BounceNote[], loopTicks: number): BounceNote[] {
  const out: BounceNote[] = [];
  for (const note of notes) {
    if (note.tick >= loopTicks) break;
    const ticks = Math.min(note.ticks, loopTicks - note.tick);
    out.push(ticks === note.ticks ? note : { ...note, ticks });
  }
  return out;
}

/** Whether `rendered` is `looped`'s note played at `tick` for `ticks`. */
const plays = (rendered: BounceNote, looped: BounceNote, tick: number, ticks: number): boolean =>
  rendered.tick === tick &&
  rendered.ticks === ticks &&
  rendered.pitch === looped.pitch &&
  rendered.velocity === looped.velocity &&
  rendered.own === looped.own;

/** Whether `loop`, repeated every `loopTicks` and cut at `duration`, gives `notes` exactly. */
function repeatsAs(
  notes: readonly BounceNote[],
  loop: readonly BounceNote[],
  loopTicks: number,
  duration: number,
): boolean {
  let i = 0;
  for (let start = 0; start < duration; start += loopTicks) {
    for (const note of loop) {
      const tick = start + note.tick;
      if (tick >= duration) break;
      const rendered = notes[i++];
      if (!rendered || !plays(rendered, note, tick, Math.min(note.ticks, duration - tick))) {
        return false;
      }
    }
  }
  return i === notes.length;
}

/** Whether every envelope, looped at `loopTicks`, reads its rendered value at every onset. */
function envelopesRepeat(region: BounceRegion, loopTicks: number): boolean {
  for (const envelope of region.envelopes) {
    for (const { tick } of region.notes) {
      const looped = envelopeValueAt(envelope, tick % loopTicks, loopTicks);
      if (looped !== envelopeValueAt(envelope, tick)) return false;
    }
  }
  return true;
}

/**
 * The envelopes' points a loop of `loopTicks` reads: those before its end,
 * less the old value held up to a change on the loop's end, which the loop
 * never reaches.
 */
const loopEnvelopes = (envelopes: readonly RollEnvelope[], loopTicks: number): RollEnvelope[] =>
  envelopes.map((envelope) => ({
    ...envelope,
    points: envelope.points.filter((point) => point.tick < loopTicks - BOUNCE_ENVELOPE_STEP_TICKS),
  }));

/**
 * The shortest loop of whole `barTicks` bars that plays `region`, rendered
 * over `duration` ticks, exactly; else the region unrolled, `duration` long.
 */
export function shortestLoop(region: BounceRegion, duration: number, barTicks: number): BounceLoop {
  for (let loopTicks = barTicks; loopTicks < duration; loopTicks += barTicks) {
    const notes = loopNotes(region.notes, loopTicks);
    if (repeatsAs(region.notes, notes, loopTicks, duration) && envelopesRepeat(region, loopTicks)) {
      return { loopTicks, notes, envelopes: loopEnvelopes(region.envelopes, loopTicks) };
    }
  }
  return { loopTicks: duration, notes: region.notes, envelopes: region.envelopes };
}
