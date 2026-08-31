/**
 * Capture-to-fixed (issue #70, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §6): a generated
 * bar that sounds right is frozen into a literal array in the document, kept
 * or nudged, and released back to generative.
 *
 * The generators own the *playback* of a captured pattern (the `pattern`
 * field on their configs); this file owns what is shared between them and the
 * player: the pitched-pattern contract, and the recorder that knows what a
 * pitched part actually sounded. The percussion figure is readable off its
 * sequencer, but an arp bar exists only as the notes it emitted — so the
 * player records them here, one bar at a time.
 */
import { TICKS_PER_BAR } from './scheduler';

/** A captured pitched bar: a MIDI note, or `null` for a rest, per step. */
export type NotePattern = readonly (number | null)[];

/** Shared by the arpeggiator and step sequencer constructors. */
export function assertNotePattern(pattern: NotePattern): void {
  if (pattern.length < 1) throw new RangeError('pattern must have at least one step');
  for (const note of pattern) {
    if (note === null) continue;
    if (!Number.isInteger(note) || note < 0 || note > 127) {
      throw new RangeError(`pattern notes must be MIDI notes or null, got ${note}`);
    }
  }
}

/**
 * Records a pitched part's note-ons per step and keeps the last completed
 * bar. A tie emits no event, so a drone capture forward-fills rests with the
 * note carried into the bar (`fill`) — which reproduces the tie exactly under
 * the step sequencer's tie rule (gate 1, repeated equal note).
 */
export class BarRecorder {
  private readonly stepsPerBar: number;
  private bar = -1;
  private slots: (number | null)[] = [];
  private lastComplete: (number | null)[] | null = null;
  private carryIntoComplete: number | null = null;
  private carryIntoCurrent: number | null = null;
  private lastNote: number | null = null;

  constructor(private readonly divisor: number) {
    this.stepsPerBar = Math.max(1, Math.round(TICKS_PER_BAR / divisor));
  }

  /** One note-on, in emission order (ticks never decrease). */
  record(tick: number, note: number): void {
    const bar = Math.floor(tick / TICKS_PER_BAR);
    if (bar > this.bar) {
      if (this.bar >= 0) {
        // A gap means every bar since the recorded one was silent: the most
        // recently *completed* bar is then all rests, under whatever note ran.
        this.lastComplete = bar === this.bar + 1 ? this.slots : this.empty();
        this.carryIntoComplete = bar === this.bar + 1 ? this.carryIntoCurrent : this.lastNote;
      }
      this.slots = this.empty();
      this.carryIntoCurrent = this.lastNote;
      this.bar = bar;
    }
    const slot = Math.floor((tick % TICKS_PER_BAR) / this.divisor);
    if (slot >= 0 && slot < this.stepsPerBar) this.slots[slot] = note;
    this.lastNote = note;
  }

  /**
   * The last completed bar, or `null` before one exists. `fill` forward-fills
   * rests with the sounding note (ties); `held` covers the all-tie case where
   * no event has fired for bars but a note is still sounding.
   */
  capture(fill: boolean, held: number | null): NotePattern | null {
    if (!this.lastComplete) {
      if (fill && held !== null) return this.empty().fill(held);
      return null;
    }
    if (!fill) return [...this.lastComplete];
    let carry = this.carryIntoComplete;
    return this.lastComplete.map((note) => {
      if (note !== null) carry = note;
      return carry;
    });
  }

  private empty(): (number | null)[] {
    return new Array<number | null>(this.stepsPerBar).fill(null);
  }
}
