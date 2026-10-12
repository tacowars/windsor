/**
 * Bounce to Roll's ratchets (windsor#755, record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 11, which supersedes
 * the ratchet parts of `2026-10-11-bounce-to-roll` decisions 4 and 8): a
 * ratchet's hits, placed one note per hit by `bounceRenderNotes.ts`, become
 * one note with `ratchet: N` only where that note plays exactly the hits
 * the generator played.
 *
 * The note runs from hit 0's written onset to the written release of the
 * note holding the last hit. The Roll plays it as a roll of N hits over its
 * length, at gate 1 with the last hit open (`RollSequencer`, `rollHits`),
 * in seconds, so a hit between ticks is no longer rounded and no hit is
 * merged. Every captured hit's onset, every closed hit's release and the
 * last hit's release must be that roll's, within `BOUNCE_TICK_EPSILON`.
 * Anything else keeps the hits as written, rounded, merged and counted as
 * before:
 *
 * - a tie past the step, or a slide out of the last hit, which the writer
 *   lengthens past the next onset: the last release moves, and the even
 *   spacing with it;
 * - a roll gated under 1 (an Arp, Figure or Basslead step) or a Euclid hold
 *   shorter than the spacing: a closed hit's release falls short;
 * - a roll a region's end cut short, or one whose written note would hold
 *   another note's hit (merged onto its tick) or start on a rounded tick;
 * - what the normaliser would clear (the record's decisions 5 and 6): a
 *   ratchet on a shared onset (a chord), or on a note shorter than
 *   `ROLL_RATCHET_MIN_TICKS`. It falls back to its hits, not a plain note.
 *
 * Pure.
 */
import { RATCHET_MAX } from '../audioConstants';
import { ROLL_RATCHET_MIN_TICKS } from '../sequencing/rollNoteTables';
import { BOUNCE_TICK_EPSILON } from './bounceRenderTables';
import type { Draft, NoteFrame } from './bounceRenderNotes';
import type { PlayedNote } from './bounceRenderTypes';
import { rollHits } from './rollSpan';

const near = (a: number, b: number): boolean => Math.abs(a - b) < BOUNCE_TICK_EPSILON;

/**
 * Whether a Roll note of `ticks` on local tick `tick`, ratcheted to
 * `hits.length`, plays the captured `hits`: each onset and release, in
 * straight ticks.
 */
function playsHits(
  hits: readonly PlayedNote[],
  tick: number,
  ticks: number,
  frame: NoteFrame,
): boolean {
  const { start, duration, clock, ratchetClock } = frame;
  const at = start + tick;
  const rolled = rollHits({
    tick: at,
    divisor: ticks,
    ratchet: hits.length,
    hold: Infinity,
    gate: 1,
    regions: [],
    songTicks: 0,
    loop: null,
    ...ratchetClock,
  });
  if (rolled.length !== hits.length) return false;
  const onset = clock.swungTicks(at);
  const release = clock.swungTicks(at + ticks);
  // The gate's leave releases a hit never let go on the region's end.
  const leave = clock.swungTicks(start + duration);
  const last = hits.length - 1;
  return hits.every((hit, j) => {
    const { offset, held } = rolled[j]!;
    const on = onset + offset / ratchetClock.secondsPerTick;
    const off = j === last ? release : on + held / ratchetClock.secondsPerTick;
    return near(hit.on, on) && near(hit.off ?? leave, off);
  });
}

/**
 * The one note a roll is written as, or null when its drafts stay as they
 * are. `hits` are the roll's captured hits in onset order, `drafts` the
 * drafts holding them (holding nothing else), in onset order, and `onsets`
 * how many drafts start on each tick.
 */
function asOneNote(
  hits: readonly PlayedNote[],
  drafts: readonly Draft[],
  onsets: ReadonlyMap<number, number>,
  frame: NoteFrame,
): Draft | null {
  const first = drafts[0];
  if (!first || first.played !== hits[0] || hits.length > RATCHET_MAX) return null;
  const end = drafts[drafts.length - 1]!.end;
  const ticks = end - first.tick;
  if (onsets.get(first.tick) !== 1 || ticks < ROLL_RATCHET_MIN_TICKS) return null;
  if (!playsHits(hits, first.tick, ticks, frame)) return null;
  return {
    ...first,
    end,
    offRounded: false,
    lost: 0,
    holds: [...hits],
    trimmed: false,
    tailCut: false,
    ratchet: hits.length,
  };
}

/** Each roll's captured hits, in the order they were played. */
function rollsOf(played: readonly PlayedNote[]): Map<number, PlayedNote[]> {
  const rolls = new Map<number, PlayedNote[]>();
  for (const note of played) {
    if (note.roll !== null) rolls.set(note.roll, [...(rolls.get(note.roll) ?? []), note]);
  }
  return rolls;
}

/**
 * Each roll's drafts, in onset order. A roll whose hit is held by a draft
 * holding anything else (a note of another roll, or a plain one, merged
 * onto one tick) has none, and stays as written.
 */
function draftsOf(drafts: readonly Draft[]): Map<number, Draft[]> {
  const byRoll = new Map<number, Draft[]>();
  const mixed = new Set<number>();
  for (const draft of drafts) {
    const rolls = new Set(draft.holds.map((note) => note.roll));
    for (const roll of rolls) {
      if (roll === null) continue;
      if (rolls.size > 1) mixed.add(roll);
      byRoll.set(roll, [...(byRoll.get(roll) ?? []), draft]);
    }
  }
  for (const roll of mixed) byRoll.delete(roll);
  return byRoll;
}

/**
 * `drafts` (placed, in onset order) with each ratchet that one note plays
 * exactly written as that note, in its hit 0's place; `played` is every
 * note the capture recorded, merged hits included.
 */
export function collapseRatchets(
  drafts: readonly Draft[],
  played: readonly PlayedNote[],
  frame: NoteFrame,
): Draft[] {
  const onsets = new Map<number, number>();
  for (const { tick } of drafts) onsets.set(tick, (onsets.get(tick) ?? 0) + 1);
  const byRoll = draftsOf(drafts);
  const notes = new Map<number, Draft>();
  for (const [roll, hits] of rollsOf(played)) {
    const note = asOneNote(hits, byRoll.get(roll) ?? [], onsets, frame);
    if (note) notes.set(roll, note);
  }
  if (notes.size === 0) return [...drafts];
  return drafts.flatMap((draft) => {
    const { roll } = draft.played;
    const note = roll === null ? undefined : notes.get(roll);
    if (!note) return [draft];
    return note.played === draft.played ? [note] : [];
  });
}
