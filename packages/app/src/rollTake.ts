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
 *   only its own source's note. One source can hold one pitch twice: under
 *   the console's Hold, `Keyboard.lift` drops a key without a note-off, so a
 *   second press of it starts a second voice while the first still rings.
 *   A press never ends a held note, then; each source and pitch keeps its
 *   pending notes in press order, and a release ends the earliest (the
 *   console sends one whenever a voice actually stops, and `MidiPerformer`
 *   releases before it restarts a struck key). Notes that overlap are
 *   settled by `mergeTake`, as any overlap is.
 * - **Onset.** A press lands in the region the engine plays at its tick
 *   (`regionState`: the transport tick modulo the song's length, or, in the
 *   one ∞ region, the transport tick itself), at its local tick modulo the
 *   region's loop. A press in a gap is ignored: recording pauses. Every tick
 *   the take is given is the transport's, which never wraps.
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
 * The regions are read once, at construction. Any other song edit splits
 * the take (decision 8): the console builds a new take over the regions as
 * they are after the edit and hands it the notes still held (`handOver`),
 * so a held note carries across the edit and a take never presses into
 * regions it was not given.
 */
import type { Region, RollNote, RollSequencerConfig } from '@windsor/engine';
import { isInfiniteRegion, regionState, ROLL_NOTES_MAX } from '@windsor/engine';
import { settle } from './rollEdits';

/** One of the part's regions, as the engine reads it, with the loop of the roll it plays (resolved by the caller). */
export interface TakeRegion extends Region {
  readonly loopTicks: number;
}

/** A note still pending: its region, onset (loop tick and region-local tick), and its length so far. */
export interface HeldNote {
  readonly source: string;
  readonly regionIndex: number;
  readonly pitch: number;
  readonly velocity: number;
  readonly tick: number;
  /** The onset in the region's local ticks, before the loop folds it: which pass it started in. */
  readonly local: number;
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
  /** The onset in the region's local ticks. */
  readonly local: number;
  /** The transport tick of the press. */
  readonly onset: number;
  /** The most it can sound: to its loop's end or its region's end, whichever is first. */
  limit: number;
  /** The highest tick seen since the press. */
  reach: number;
  /** Its length once a jump cut it, else null. */
  frozen: number | null;
  /** Pressed since the playhead last moved. */
  fresh: boolean;
}

/** A note's length with its end at transport tick `end`: at least 1, at most its limit. */
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
  /** Held notes in press order; a source and pitch may appear more than once. */
  private readonly pending: Pending[] = [];
  private readonly finished = new Map<number, RollNote[]>();
  private playhead = Number.NEGATIVE_INFINITY;

  /** The take of a part playing `regions` in a song `songTicks` long. */
  constructor(
    private readonly songTicks: number,
    private readonly regions: readonly TakeRegion[],
  ) {}

  /**
   * A key down from `source` at transport tick `songTick`, velocity 0..1. A
   * note the source already holds at the pitch is left ringing (a second
   * voice under Hold), as is another source's. A press in a gap records
   * nothing.
   */
  press(source: string, pitch: number, velocity: number, songTick: number): void {
    this.see(songTick);
    const state = regionState(this.regions, this.songTicks, songTick);
    if (!state.live) return;
    const regionIndex = state.index;
    const region = this.regions[regionIndex] as TakeRegion;
    const local = state.localTick;
    const tick = local % region.loopTicks;
    const toRegionEnd = isInfiniteRegion(this.regions, this.songTicks)
      ? Number.POSITIVE_INFINITY
      : region.duration - local;
    const limit = Math.min(region.loopTicks - tick, toRegionEnd);
    this.pending.push({
      source,
      regionIndex,
      pitch,
      velocity,
      tick,
      local,
      onset: songTick,
      limit,
      reach: songTick,
      frozen: null,
      fresh: true,
    });
  }

  /**
   * A key up (or a voice stopped) from `source` at `songTick`: the earliest
   * note that source holds at the pitch, if any, is finished there (or at
   * its cut).
   */
  release(source: string, pitch: number, songTick: number): void {
    this.see(songTick);
    const i = this.pending.findIndex((note) => note.source === source && note.pitch === pitch);
    if (i < 0) return;
    const [note] = this.pending.splice(i, 1);
    this.finish(note as Pending, songTick);
  }

  /**
   * The playhead at `songTick`. Below its last tick, a seek or a loop jump:
   * every held note of the earlier pass is frozen at the last tick it saw.
   */
  advance(songTick: number): void {
    if (songTick < this.playhead) this.jump(songTick);
    this.playhead = songTick;
    this.see(songTick);
    for (const note of this.pending) note.fresh = false;
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
    for (const note of this.pending) note.frozen ??= lengthNow(note);
    this.playhead = Number.NEGATIVE_INFINITY;
  }

  /** The take's end (a stop, a part switch, Rec off): every held note is cut at `songTick` and finished. */
  end(songTick: number): void {
    for (const note of this.pending) this.finish(note, songTick);
    this.pending.length = 0;
  }

  /** The notes still pending, in press order, each with its length so far. */
  held(): HeldNote[] {
    return this.pending.map((note) => ({
      source: note.source,
      regionIndex: note.regionIndex,
      pitch: note.pitch,
      velocity: note.velocity,
      tick: note.tick,
      local: note.local,
      ticks: lengthNow(note),
    }));
  }

  /**
   * Hand the notes this take still holds, and its finished notes not yet
   * drained, to `next`, the take that follows it across an edit (decision
   * 8). A note follows its region by identity, not by index: to the region
   * of `next` with the same start and loop, wherever an edit to another
   * region moved it in the list. A held note carries there while that
   * region still holds its onset, its limit cut to the region's end as it
   * is now. A note whose region did not survive is dropped: there is
   * nowhere to write it. This take is then empty.
   */
  handOver(next: RollTake): void {
    const infinite = isInfiniteRegion(next.regions, next.songTicks);
    for (const note of this.pending) {
      const index = this.followed(note.regionIndex, next);
      const region = next.regions[index];
      if (!region) continue;
      const toRegionEnd = infinite ? Number.POSITIVE_INFINITY : region.duration - note.local;
      if (toRegionEnd <= 0) continue;
      next.pending.push({
        ...note,
        regionIndex: index,
        limit: Math.min(note.limit, toRegionEnd),
      });
    }
    for (const [regionIndex, notes] of this.finished) {
      const index = this.followed(regionIndex, next);
      if (index < 0) continue;
      next.finished.set(index, [...(next.finished.get(index) ?? []), ...notes]);
    }
    next.playhead = this.playhead;
    this.pending.length = 0;
    this.finished.clear();
  }

  /** The finished notes since the last drain, per region in region order; the list is then empty. */
  drain(): TakeWrite[] {
    const out = [...this.finished.entries()]
      .sort(([a], [b]) => a - b)
      .map(([regionIndex, notes]) => ({ regionIndex, notes }));
    this.finished.clear();
    return out;
  }

  /** The index in `next` of this take's region `regionIndex`: the one with its start and loop, or -1. */
  private followed(regionIndex: number, next: RollTake): number {
    const old = this.regions[regionIndex];
    if (!old) return -1;
    return next.regions.findIndex(
      (region) => region.start === old.start && region.loopTicks === old.loopTicks,
    );
  }

  /** Every held note has now seen `songTick`. */
  private see(songTick: number): void {
    for (const note of this.pending) note.reach = Math.max(note.reach, songTick);
  }

  /** A jump back to `songTick`: freeze each note of the earlier pass at the last tick it saw. */
  private jump(songTick: number): void {
    for (const note of this.pending) {
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
