/**
 * What Bounce to Roll hands the app (windsor#741, record
 * `2026-10-11-bounce-to-roll` decisions 2, 6 and 8): the one partial that
 * rewrites the part, and the summary its toast is built from, or the
 * refusal the error toast is built from. Data only: the toasts' sentences
 * are the app's.
 */
import type { DocumentPartial } from './arrangementDocument';
import type { SeqField } from '../sequencing/regionGate';

/** A Figure part whose canon followed the bounced part, and so loses its leader (decision 8). */
export interface BounceFollower {
  readonly slot: number;
  readonly name: string;
}

/** Decision 8's counts, summed over the notes written (each region's loop). */
export interface BounceSummary {
  /** Notes written across every region's loop. */
  readonly notes: number;
  /** The part's regions, an empty one included. */
  readonly regions: number;
  /**
   * Written ratchet onsets and releases, and swung Euclid releases, that
   * fell between ticks. A ratchet written as one note's `ratchet`
   * (windsor#755) rounds nothing; only one written as its hits counts.
   */
  readonly ticksRounded: number;
  /** Hits of a ratchet written as its hits, merged into an earlier hit on their tick, unheard. */
  readonly ratchetHitsLost: number;
  /**
   * Accents baked into their velocity, whose mod is lost: those of a region
   * whose accents differ, or on an onset another note shares (windsor#755).
   */
  readonly accentsLostMod: number;
  /** Notes held into a later onset of their own pitch, trimmed there. */
  readonly repeatsTrimmed: number;
  /** Euclid holds cut at their region's end. */
  readonly euclidTailsCut: number;
  /**
   * Notes written at velocity 0, which the Roll plays as rests: plain notes
   * of a part at Vel 0 whose Vel rose to an accent's bump (the record's
   * boundary case).
   */
  readonly silenced: number;
  /** The sequencer lanes the render read and the bounce removed: "Skip and Gate lanes baked". */
  readonly lanesBaked: readonly SeqField[];
  /**
   * The part's Vel after the bounce: its own, or the highest level a baked
   * accent played (decision 4, and windsor#755).
   */
  readonly velocity: number;
  /** The Figure parts whose canon this part led, in song order. */
  readonly followers: readonly BounceFollower[];
}

/**
 * Why a bounce changed nothing (decision 6). `region` is the region's
 * number as the song shows it, from 1.
 */
export type BounceRefusal =
  /** Its loop needs `notes` notes, past `ROLL_NOTES_MAX`. */
  | { readonly cap: 'notes'; readonly region: number; readonly notes: number }
  /**
   * Its loop needs `ticks`, past `ROLL_LOOP_TICKS_MAX`: `bars` bars of the
   * song's meter, the last counted whole when it is partial.
   */
  | {
      readonly cap: 'loop';
      readonly region: number;
      readonly ticks: number;
      readonly bars: number;
    };

export type BounceResult =
  | {
      readonly ok: true;
      /** One `ctx.change`-ready partial: the part's regions, sequencer, Vel and lanes. */
      readonly partial: DocumentPartial;
      readonly summary: BounceSummary;
    }
  | { readonly ok: false; readonly refusal: BounceRefusal };
