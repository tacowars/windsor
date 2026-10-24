/**
 * What Bounce to Roll's render hands back for one region (windsor#740,
 * record `2026-10-11-bounce-to-roll` decisions 3, 4 and 8), and what it
 * captures on the way. The render is `bounceRender.ts`; the loop search,
 * the caps and the Vel rescale across regions read these next. Since
 * windsor#755 (record `2026-10-12-roll-note-accent-and-ratchet` decision
 * 11) a note may carry an accent and a ratchet, and a region its roll's
 * accent amounts.
 */
import type { SeqField } from '../sequencing/regionGate';
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import type { RollNote } from '../sequencing/rollSequencer';

/**
 * What a written note lost or had changed on the way to the grid, so that
 * the summary can count over whichever notes a loop keeps (decision 8:
 * the counts are over the notes written).
 */
export interface BounceMarks {
  /**
   * Its written onset and release that fell between ticks and were rounded:
   * 0, 1 or 2. A release a slide, a trim or the region's end set is a
   * whole tick and does not count; a merged hit's own roundings do not.
   */
  readonly rounded: number;
  /** Ratchet hits that rounded onto its onset tick and were merged into it, unheard. */
  readonly lost: number;
  /**
   * Its accent was baked into its velocity, not written as `accent`, and
   * its mod (above 0) is lost: its region's accents differ, or it shares
   * its onset with another note.
   */
  readonly accentMod: boolean;
  /** It was held into a later onset of its own pitch and trimmed there. */
  readonly trimmed: boolean;
  /** A Euclid hold that crossed the region's end, cut there. */
  readonly tailCut: boolean;
}

/**
 * One rendered note: a Roll note in the region's local ticks, at the
 * velocity the part played (`partNoteOn`'s, before the Vel rescale across
 * every region, which is the bounce's). An `accent` plays its region's
 * amounts (`BounceRegion.accent`); a `ratchet` plays its hits as the
 * generator did.
 */
export interface BounceNote extends RollNote {
  /**
   * What the part played: its Vel × the event's velocity, moved by a varied
   * step's velocity offset (windsor#945), plus an accent's bump, at most 1. A note carrying `accent` holds its level without the
   * bump, which the Roll adds back as it plays.
   */
  readonly velocity: number;
  /**
   * The event's own velocity, a Figure cell's, else 1: what a part Vel of 0
   * writes in place of 0 ÷ 0 (the record's boundary case).
   */
  readonly own: number;
  readonly marks: BounceMarks;
}

/** The approximations decision 8 names, summed over a set of notes. */
export interface BounceCounts {
  readonly notes: number;
  readonly ticksRounded: number;
  readonly ratchetHitsLost: number;
  readonly accentsLostMod: number;
  readonly repeatsTrimmed: number;
  readonly euclidTailsCut: number;
  /** Notes the part played at velocity 0 (a part Vel of 0, or a Figure cell at 0). */
  readonly zeroVelocity: number;
}

/** An accent's velocity bump and per-note mod, as a generator's note-on carries them. */
export interface AccentAmounts {
  readonly velocity: number;
  readonly mod: number;
}

/** One region rendered as it plays from its start. */
export interface BounceRegion {
  /** Sorted by tick, then pitch, as a Roll holds them; no two of one pitch on one tick. */
  readonly notes: readonly BounceNote[];
  /**
   * The amounts every note's `accent` plays: the region's roll's
   * `accentVelocity` and `accentMod`. Null when no note carries one.
   */
  readonly accent: AccentAmounts | null;
  /** The step-mod rows as clip envelopes, one per row that moved on some note. */
  readonly envelopes: readonly RollEnvelope[];
  readonly counts: BounceCounts;
  /** The part's sequencer lanes the render read (and the bounce bakes). */
  readonly seqLanes: readonly SeqField[];
}

/**
 * One note as the part played it, before it meets the tick grid: the call
 * the player makes on its part (`noteOn` or `trigger`), its times in
 * straight ticks from transport tick 0, where the clock's seconds put them.
 */
export interface PlayedNote {
  readonly pitch: number;
  /** Where its note-on sounds. */
  readonly on: number;
  /** Where it is released: a `trigger`'s hold, or the note-off that let it go; null while held. */
  off: number | null;
  readonly velocity: number;
  /** What it would have played without its accent: the part's Vel × `own`, moved by any velocity offset. */
  readonly plain: number;
  readonly own: number;
  /** Its accent's bump and mod, as its event carried them; undefined unaccented. */
  readonly accent: AccentAmounts | undefined;
  readonly slide: boolean;
  /** Its step's offsets, one per voice target row; absent when every lane read 0. */
  readonly stepMod: readonly number[] | undefined;
  /**
   * The ratchet it is a hit of, as an id unique within the capture: every
   * hit of one roll of two or more carries it. Null on a plain note.
   */
  readonly roll: number | null;
}
