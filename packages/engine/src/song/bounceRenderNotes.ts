/**
 * Bounce to Roll's notes (windsor#740, record `2026-10-11-bounce-to-roll`
 * decision 4): what a region's part played, put on the Roll's tick grid.
 *
 * - **Ticks.** Every onset and release is a time in straight ticks. It is
 *   turned back into a tick through the clock's inverse warp
 *   (`unswingTicks`) at the transport's phase, then the region's start is
 *   subtracted, so a region that starts off the swing grid is read where
 *   the clock swung it. A position between two ticks goes to whichever
 *   sounds nearer its time, the later on a tie, and is counted unless a
 *   rule below replaces it with a whole tick. A release
 *   is at least one tick after its onset, and a note never released ends
 *   at the region's end.
 * - **Hits on one tick.** A note whose onset lands on the tick of an
 *   earlier note of its pitch (two ratchet hits at 24 PPQ) is merged into
 *   it, which runs to the later release; the merged hit is counted lost,
 *   and its own roundings are not counted.
 * - **Slide.** A note held into a slide's onset by another pitch is made to
 *   end one tick after it, so the Roll slides them by overlap.
 * - **Overlaps.** A note held into a later onset of its own pitch is
 *   trimmed there and counted; one held into another pitch's onset that is
 *   not its slide is trimmed there on a mono patch, where the engine cut
 *   it, and kept on a poly one.
 * - **The region's end.** A hold past it (a Euclid hit's) is cut there and
 *   counted.
 */
import { BOUNCE_TICK_EPSILON } from './bounceRenderTables';
import type { WarpClock } from './bounceRenderCapture';
import type { BounceNote, PlayedNote } from './bounceRenderTypes';

/** Where a region's notes are written. */
export interface NoteFrame {
  /** The region's first transport tick. */
  readonly start: number;
  /** The region's length in ticks: no note ends past it. */
  readonly duration: number;
  /** The part's patch is mono: an onset cuts what another pitch holds, unless it slides. */
  readonly mono: boolean;
  /** The swing the region was played under. */
  readonly clock: WarpClock;
}

/** A written note with the step offsets its onset carried, which its envelopes read. */
export interface WrittenNote {
  readonly note: BounceNote;
  readonly stepMod: readonly number[] | undefined;
}

/** A transport tick a played position lands on, and whether it fell between two. */
export interface SnappedTick {
  readonly tick: number;
  readonly rounded: boolean;
}

/** A note on its way to the grid. */
interface Draft {
  readonly played: PlayedNote;
  readonly tick: number;
  end: number;
  /** Its onset fell between ticks. */
  readonly onRounded: boolean;
  /** Its written release is one that fell between ticks: not one a slide, a trim or the region's end set. */
  offRounded: boolean;
  lost: number;
  trimmed: boolean;
  tailCut: boolean;
  /** The onset this note slid into, which its overlap is kept for. */
  slidInto: Draft | null;
}

/**
 * The tick a time of `warped` straight ticks sounds on: its inverse warp
 * when that is a whole tick, else whichever of the two ticks around it
 * sounds nearer, the later on a tie.
 */
export function snapTick(
  warped: number,
  clock: WarpClock,
  epsilon = BOUNCE_TICK_EPSILON,
): SnappedTick {
  const position = clock.unswungTicks(warped);
  const whole = Math.round(position);
  if (Math.abs(position - whole) < epsilon) return { tick: whole, rounded: false };
  const before = Math.floor(position);
  const after = before + 1;
  const toBefore = warped - clock.swungTicks(before);
  const toAfter = clock.swungTicks(after) - warped;
  return { tick: toAfter <= toBefore + epsilon ? after : before, rounded: true };
}

function draftOf(played: PlayedNote, frame: NoteFrame): Draft {
  const on = snapTick(played.on, frame.clock);
  const off = played.off === null ? null : snapTick(played.off, frame.clock);
  // A ratchet hit just short of the region's end may round onto it: it joins the hit before.
  const tick = Math.min(on.tick - frame.start, frame.duration - 1);
  const release = off === null ? frame.duration : off.tick - frame.start;
  return {
    played,
    tick,
    end: Math.max(release, tick + 1),
    onRounded: on.rounded,
    offRounded: off?.rounded === true,
    lost: 0,
    trimmed: false,
    tailCut: false,
    slidInto: null,
  };
}

/** The drafts in onset order, a later one on the tick of an earlier one of its pitch merged into it. */
function mergeOneTick(drafts: readonly Draft[]): Draft[] {
  const ordered = [...drafts].sort((a, b) => a.tick - b.tick);
  const kept: Draft[] = [];
  const first = new Map<string, Draft>();
  for (const draft of ordered) {
    const key = `${draft.tick}:${draft.played.pitch}`;
    const earlier = first.get(key);
    if (!earlier) {
      first.set(key, draft);
      kept.push(draft);
      continue;
    }
    earlier.end = Math.max(earlier.end, draft.end);
    earlier.lost += 1 + draft.lost;
  }
  return kept;
}

/** A release a slide, a trim or the region's end sets: a whole tick, so no longer a rounded one. */
function setEnd(draft: Draft, end: number): void {
  draft.end = end;
  draft.offRounded = false;
}

/** The drafts grouped by onset tick, in order. */
function byTick(drafts: readonly Draft[]): Draft[][] {
  const groups: Draft[][] = [];
  for (const draft of drafts) {
    const last = groups[groups.length - 1];
    if (last && last[0]!.tick === draft.tick) last.push(draft);
    else groups.push([draft]);
  }
  return groups;
}

/** Each slide's held note of another pitch runs one tick past the slide's onset. */
function lengthenSlides(groups: readonly Draft[][]): void {
  let held: Draft[] = [];
  for (const group of groups) {
    const tick = group[0]!.tick;
    held = held.filter((draft) => draft.end >= tick);
    for (const slide of group) {
      if (!slide.played.slide) continue;
      for (const from of held) {
        if (from.played.pitch === slide.played.pitch) continue;
        setEnd(from, tick + 1);
        from.slidInto = slide;
      }
    }
    held.push(...group);
  }
}

/** A note held into a later onset is trimmed there: of its own pitch always, of another on a mono patch. */
function trimOverlaps(groups: readonly Draft[][], mono: boolean): void {
  let held: Draft[] = [];
  for (const group of groups) {
    const tick = group[0]!.tick;
    for (const draft of held) {
      if (draft.end <= tick) continue;
      if (group.some((onset) => onset.played.pitch === draft.played.pitch)) {
        setEnd(draft, tick);
        draft.trimmed = true;
      } else if (mono && group.some((onset) => onset !== draft.slidInto)) {
        setEnd(draft, tick);
      }
    }
    held = held.filter((draft) => draft.end > tick);
    held.push(...group);
  }
}

function written(draft: Draft): WrittenNote {
  const { played, tick, end, onRounded, offRounded, lost, trimmed, tailCut } = draft;
  const rounded = Number(onRounded) + Number(offRounded);
  const marks = { rounded, lost, accentMod: played.mod !== 0, trimmed, tailCut };
  const note: BounceNote = {
    tick,
    ticks: end - tick,
    pitch: played.pitch,
    velocity: played.velocity,
    own: played.own,
    marks,
  };
  return { note, stepMod: played.stepMod };
}

/** The region's played notes as Roll notes, sorted by tick then pitch. */
export function writeNotes(played: readonly PlayedNote[], frame: NoteFrame): WrittenNote[] {
  const drafts = mergeOneTick(played.map((note) => draftOf(note, frame)));
  const groups = byTick(drafts);
  lengthenSlides(groups);
  trimOverlaps(groups, frame.mono);
  for (const draft of drafts) {
    if (draft.end <= frame.duration) continue;
    setEnd(draft, frame.duration);
    draft.tailCut = true;
  }
  return drafts.sort((a, b) => a.tick - b.tick || a.played.pitch - b.played.pitch).map(written);
}
