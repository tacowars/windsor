/**
 * A Roll recording take, without the DOM or the engine (windsor#662, record
 * `2026-10-09-roll-recording` decisions 3–9): the notes tacowars plays,
 * stamped in song ticks (`rollTakeStamp.ts` then `audibleTick`), turned into
 * `RollNote`s for the regions they started in, and `mergeTake`, the write of
 * one region's finished notes into its roll.
 *
 * - **Sources.** A note is held by its input source (the console
 *   `Keyboard`'s source key: a computer key, or one MIDI input's note) and
 *   its pitch, so two sources can hold one pitch at once; a release ends
 *   only its own source's note. Two such notes that overlap are settled by
 *   `mergeTake`, as any overlap is.
 * - **Onset.** A press lands in the region under it, at its local tick
 *   modulo the region's loop. A press in a gap is ignored: recording pauses.
 * - **Length and write are separate.** A held note grows with the ticks the
 *   take sees, up to its loop's end or its region's end, whichever is first,
 *   and stops there. A seek or a loop jump freezes it at the last tick it saw.
 *   A cut never writes: the note stays pending, and is finished on its
 *   release or at `end()`, so the Roll never starts it again over the voice
 *   still ringing.
 * - **Seeks.** The console calls `cut(songTick)` on every seek, forward or
 *   back, with the last tick heard before it: every held note is frozen
 *   there, pending until its release or `end()`, and the take stays open. A
 *   forward seek moves the playhead up, so only `cut` can tell of it.
 * - **The clock.** `advance` is the playhead, and judges a jump `cut` was
 *   not told of (a loop jump, or a missed seek) as a safety net: a
 *   tick lower than its last is a seek or a loop jump. A press's or a
 *   release's tick is the event's own stamp, which lags the playhead (it was
 *   heard before the frame that reads it), so a lower one there is not a
 *   jump. A note pressed after the jump but before the playhead saw it (its
 *   onset at or before the new playhead) is the new pass's and is not cut;
 *   a release stamped before its own press's onset came after an unseen
 *   jump, and is cut at the last tick the note saw.
 * - **Handing out.** Finished notes are collected per region and taken with
 *   `drain()` (a drained list, not a callback, so the caller decides when
 *   to write); each region's list is written through `mergeTake`.
 *
 * The regions are read once, at construction: any other song edit splits
 * the take (decision 8), so a take never outlives the regions it was given.
 */
import type { RollNote, RollSequencerConfig } from '@windsor/engine';
import { ROLL_NOTES_MAX } from '@windsor/engine';
import { settle } from './rollEdits';

/** One region of the part in song ticks, with the loop of the roll it plays (resolved by the caller). */
export interface TakeRegion {
  readonly start: number;
  readonly duration: number;
  readonly loopTicks: number;
}

/** A note still pending: its region, onset (local tick), and its length so far. */
export interface HeldNote {
  readonly source: string;
  readonly regionIndex: number;
  readonly pitch: number;
  readonly velocity: number;
  readonly tick: number;
  readonly ticks: number;
}

/** One region's finished notes, in the order they were finished. */
export interface TakeWrite {
  readonly regionIndex: number;
  readonly notes: readonly RollNote[];
}

/** A held note's state while the take runs. */
interface Pending {
  readonly source: string;
  readonly regionIndex: number;
  readonly pitch: number;
  readonly velocity: number;
  readonly tick: number;
  /** The song tick of the press. */
  readonly onset: number;
  /** The most it can sound: to its loop's end or its region's end, whichever is first. */
  readonly limit: number;
  /** The highest tick seen since the press. */
  reach: number;
  /** Its length once a jump cut it, else null. */
  frozen: number | null;
  /** Pressed since the playhead last moved. */
  fresh: boolean;
}

/** A held note's key: its source and its pitch (a number, so the first colon divides them). */
const heldKey = (source: string, pitch: number): string => `${pitch}:${source}`;

/** The index of the region holding song tick `songTick`, or −1 in a gap. */
const regionAt = (regions: readonly TakeRegion[], songTick: number): number =>
  regions.findIndex((r) => songTick >= r.start && songTick < r.start + r.duration);

/** A note's length with its end at song tick `end`: at least 1, at most its limit. */
const lengthTo = (note: Pending, end: number): number =>
  Math.max(1, Math.min(note.limit, end - note.onset));

/** A note's length now: frozen, or grown to the last tick it saw. */
const lengthNow = (note: Pending): number => note.frozen ?? lengthTo(note, note.reach);

/** A pending note as the roll stores it: a velocity of 1 leaves no key, as the normaliser writes it. */
function toRollNote(note: Pending, ticks: number): RollNote {
  const { tick, pitch, velocity } = note;
  return velocity === 1 ? { tick, ticks, pitch } : { tick, ticks, pitch, velocity };
}

/** One take: press, release and the playhead in, finished notes out per region. */
export class RollTake {
  /** Held notes by source and pitch (`heldKey`), in press order. */
  private readonly pending = new Map<string, Pending>();
  private readonly finished = new Map<number, RollNote[]>();
  private playhead = Number.NEGATIVE_INFINITY;

  constructor(private readonly regions: readonly TakeRegion[]) {}

  /**
   * A key down from `source` at `songTick`, velocity 0..1. A pitch that
   * source already holds is ended there first, as `MidiPerformer` restarts a
   * struck key; another source's note at the pitch is left alone. A press in
   * a gap records nothing.
   */
  press(source: string, pitch: number, velocity: number, songTick: number): void {
    this.release(source, pitch, songTick);
    const regionIndex = regionAt(this.regions, songTick);
    const region = this.regions[regionIndex];
    if (!region) return;
    const local = songTick - region.start;
    const tick = local % region.loopTicks;
    const limit = Math.min(region.loopTicks - tick, region.duration - local);
    this.pending.set(heldKey(source, pitch), {
      source,
      regionIndex,
      pitch,
      velocity,
      tick,
      onset: songTick,
      limit,
      reach: songTick,
      frozen: null,
      fresh: true,
    });
  }

  /** A key up from `source` at `songTick`: that source's note, if held, is finished there (or at its cut). */
  release(source: string, pitch: number, songTick: number): void {
    this.see(songTick);
    const key = heldKey(source, pitch);
    const note = this.pending.get(key);
    if (!note) return;
    this.pending.delete(key);
    this.finish(note, songTick);
  }

  /**
   * The playhead at `songTick`. Below its last tick, a seek or a loop jump:
   * every held note of the earlier pass is frozen at the last tick it saw.
   */
  advance(songTick: number): void {
    if (songTick < this.playhead) this.jump(songTick);
    this.playhead = songTick;
    this.see(songTick);
    for (const note of this.pending.values()) note.fresh = false;
  }

  /**
   * A seek, forward or back, after the playhead last heard `songTick`: every
   * held note is frozen at `songTick` (a note already frozen keeps its cut)
   * and stays pending until its release or the take's end. The take stays
   * open, and the next `advance` starts a fresh playhead, so it judges no
   * jump of its own over the seek.
   */
  cut(songTick: number): void {
    this.see(songTick);
    for (const note of this.pending.values()) note.frozen ??= lengthNow(note);
    this.playhead = Number.NEGATIVE_INFINITY;
  }

  /** The take's end (a stop, a part switch, Rec off): every held note is cut at `songTick` and finished. */
  end(songTick: number): void {
    for (const note of this.pending.values()) this.finish(note, songTick);
    this.pending.clear();
  }

  /** The notes still pending, in press order, each with its length so far. */
  held(): HeldNote[] {
    return [...this.pending.values()].map((note) => ({
      source: note.source,
      regionIndex: note.regionIndex,
      pitch: note.pitch,
      velocity: note.velocity,
      tick: note.tick,
      ticks: lengthNow(note),
    }));
  }

  /** The finished notes since the last drain, per region in region order; the list is then empty. */
  drain(): TakeWrite[] {
    const out = [...this.finished.entries()]
      .sort(([a], [b]) => a - b)
      .map(([regionIndex, notes]) => ({ regionIndex, notes }));
    this.finished.clear();
    return out;
  }

  /** Every held note has now seen `songTick`. */
  private see(songTick: number): void {
    for (const note of this.pending.values()) note.reach = Math.max(note.reach, songTick);
  }

  /** A jump back to `songTick`: freeze each note of the earlier pass at the last tick it saw. */
  private jump(songTick: number): void {
    for (const note of this.pending.values()) {
      const newPass = note.fresh && note.onset <= songTick;
      if (newPass || note.frozen !== null) continue;
      note.frozen = lengthNow(note);
    }
  }

  /** `note` ended at `songTick` (or at its cut) and handed to its region. */
  private finish(note: Pending, songTick: number): void {
    // An end before the onset came after a jump the playhead had not yet seen.
    const end = songTick >= note.onset ? songTick : note.reach;
    const ticks = note.frozen ?? lengthTo(note, end);
    const list = this.finished.get(note.regionIndex) ?? [];
    list.push(toRollNote(note, ticks));
    this.finished.set(note.regionIndex, list);
  }
}

/** A merged roll, and whether it now holds `ROLL_NOTES_MAX` notes and takes no new one. */
export interface TakeMerge {
  readonly config: RollSequencerConfig;
  readonly full: boolean;
}

const at = (note: RollNote): string => `${note.tick}:${note.pitch}`;

/**
 * One region's finished notes written into its roll (decisions 4 and 9). A
 * note at the tick and pitch of one already there replaces it, before the
 * cap is checked, so it is written even in a full roll; past
 * `ROLL_NOTES_MAX` the notes that would add to the count are not written.
 * The result goes through `settle`, the normaliser's rules: where two notes
 * of a pitch overlap, the earlier is trimmed. Not `addNote`, which refuses
 * any note at the cap before a replacement can be preferred.
 */
export function mergeTake(config: RollSequencerConfig, notes: readonly RollNote[]): TakeMerge {
  const merged = [...config.notes];
  const index = new Map(merged.map((note, i) => [at(note), i]));
  for (const note of notes) {
    const i = index.get(at(note));
    if (i !== undefined) merged[i] = note;
    else if (merged.length < ROLL_NOTES_MAX) {
      index.set(at(note), merged.length);
      merged.push(note);
    }
  }
  const settled = settle({ config: { ...config, notes: merged }, selected: [] }).config;
  return { config: settled, full: settled.notes.length >= ROLL_NOTES_MAX };
}
