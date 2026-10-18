/**
 * The keyboard fold (windsor#918, record `2026-10-18-keyboard-fold`), pure
 * and without the DOM: the set of notes a folded part plays at a tick, the
 * folded keys a view shows, the slots a pick holds, the home row's notes,
 * and the MIDI judge with its grace window. Every later fold ticket reads it.
 *
 * - **The set** (decision 3): Scale is the key's scale (`scalePitchClasses`,
 *   as the Roll colours notes); Chord is the chord's tones at the tick
 *   (`tonesOf` over the engine's `chordAt`), falling back to the scale when
 *   the song has no harmony events.
 * - **The keys** (decision 4, Decided 4): one key per tone, from the set's
 *   root in the label's octave (or its first tone above the root, when the
 *   set leaves the root out), each row ending on its first key's note.
 * - **The judge** (decision 7, Decided 7): with Chord and the transport
 *   running, a note passes at the tick it was heard or at any of the grace
 *   window's ticks after it, walked as the clock steps (`followingTick`), so
 *   a note near a loop's end is judged against the chord the loop plays next.
 */
import type { Harmony, HarmonyChord, MusicPart, TickLoop } from '@windsor/engine';
import { SEMITONES_PER_OCTAVE, chordAt, followingTick, scaleOffsets } from '@windsor/engine';
import { noteName, pitchClass } from './consoleFormat';
import type { KeysPick } from './keyboardConstants';
import { KEYBOARD_FOLD_TABLE, type KeyboardFoldTable } from './keyboardFoldTables';
import { scalePitchClasses, tonesOf } from './rollHarmony';

/** A part's fold, as the song holds it (`MusicPart.fold`; absent reads as `off`). */
export type PartFold = NonNullable<MusicPart['fold']>;
/** A fold that folds: the set it plays. */
export type FoldMode = Exclude<PartFold, 'off'>;

/** The notes a folded part plays, as pitch classes and their order up from the first. */
export interface FoldSet {
  /** The set's root: the key's root for Scale, the chord's root for Chord. */
  readonly rootPc: number;
  /** The tone a row starts on: the root when the set holds it, else the set's first tone above it. */
  readonly firstPc: number;
  /** Each tone as semitones above `firstPc`, ascending from 0, each under an octave. */
  readonly steps: readonly number[];
}

/** One folded key. */
export interface FoldKey {
  readonly note: number;
  /** Its pitch class's name, without the octave (`A`). */
  readonly name: string;
  /** True on the set's root (Decided 1 marks it). */
  readonly root: boolean;
  /** True past the engine's range: drawn hatched, and it plays nothing. */
  readonly outOfRange: boolean;
}

/** What the keys show: the label's octave and the pick's octaves and rows. */
export interface FoldView extends KeysPick {
  /** The octave label's number: the keyboard's octave, note 12 × octave its C. */
  readonly octave: number;
}

export interface FoldedKeys {
  /** The rows, the lowest first; each ends on its first key's note. */
  readonly rows: readonly (readonly FoldKey[])[];
  /** The first key named with its own octave (`A2`, `D2`), as the Roll names it. */
  readonly label: string;
}

/** The set from its root and its pitch classes, ordered up from its first tone. */
function setOf(rootPc: number, pcs: ReadonlySet<number>): FoldSet {
  const above = [...pcs].map((pc) => pitchClass(pc - rootPc)).sort((a, b) => a - b);
  const first = above[0] ?? 0;
  const steps = above.length > 0 ? above.map((tone) => tone - first) : [0];
  return { rootPc, firstPc: pitchClass(rootPc + first), steps };
}

/** The set `fold` plays at song tick `tick` (the audible tick while running, else the standing one). */
export function foldSetAt(
  fold: FoldMode,
  harmony: Harmony,
  songTicks: number,
  tick: number,
): FoldSet {
  const chord = fold === 'chord' ? chordAt(harmony, songTicks, tick) : null;
  if (!chord) return setOf(pitchClass(harmony.root), scalePitchClasses(harmony));
  const tones = tonesOf(harmony, chord);
  return setOf(tones.rootPc ?? pitchClass(harmony.root), tones.chordPcs);
}

/** The note of the first key at `octave`: the first tone at or above the root in that octave. */
const firstNoteAt = (set: FoldSet, octave: number): number =>
  SEMITONES_PER_OCTAVE * octave + set.rootPc + pitchClass(set.firstPc - set.rootPc);

/** The note `index` keys up from `first`, octaves carried. */
function noteAt(set: FoldSet, first: number, index: number): number {
  const tones = set.steps.length;
  const step = set.steps[index % tones] ?? 0;
  return first + SEMITONES_PER_OCTAVE * Math.floor(index / tones) + step;
}

/**
 * The slots a row of `pick` holds with `tones` tones in the set: (octaves a
 * row × tones) + 1, the closing key included. The folded stand-in for a
 * row's white keys in `keyboardViewModel.ts` and `keyboardLayout.ts`.
 */
export const foldSlots = (tones: number, pick: KeysPick): number =>
  (pick.octaves / pick.rows) * tones + 1;

/**
 * The folded keys `view` shows of `set`: rows of `foldSlots` keys, the lower
 * octaves on the lower row, each row ending on its first key's note an
 * octave or more up, so the lower row's last key and the upper row's first
 * are one note (Decided 4).
 */
export function foldedKeys(
  set: FoldSet,
  view: FoldView,
  table: KeyboardFoldTable = KEYBOARD_FOLD_TABLE,
): FoldedKeys {
  const first = firstNoteAt(set, view.octave);
  const perRow = view.octaves / view.rows;
  const count = foldSlots(set.steps.length, view);
  const rows: FoldKey[][] = [];
  for (let row = 0; row < view.rows; row++) {
    const start = first + SEMITONES_PER_OCTAVE * perRow * row;
    const keys: FoldKey[] = [];
    for (let index = 0; index < count; index++) {
      const note = noteAt(set, start, index);
      const pc = pitchClass(note);
      keys.push({
        note,
        name: table.names[pc] ?? '',
        root: pc === set.rootPc,
        outOfRange: note > table.noteMax,
      });
    }
    rows.push(keys);
  }
  return { rows, label: noteName(first) };
}

/**
 * The note a home row letter plays over `set` at `octave` (decision 6): the
 * letters take the folded keys in order from the first and run on past the
 * shown keys. Null for any other letter, and for a note past the range.
 */
export function homeRowNote(
  letter: string,
  set: FoldSet,
  octave: number,
  table: KeyboardFoldTable = KEYBOARD_FOLD_TABLE,
): number | null {
  const index = table.homeRow.indexOf(letter);
  if (index < 0) return null;
  const note = noteAt(set, firstNoteAt(set, octave), index);
  return note > table.noteMax ? null : note;
}

/** The part's fold and the song it folds to. */
export interface FoldSong {
  readonly fold: PartFold;
  readonly harmony: Harmony;
  readonly songTicks: number;
}

/** Where the transport is: running or not, where it stands, and what it wraps. */
export interface FoldClock {
  readonly running: boolean;
  /** Where the playhead stands while the transport is stopped or paused. */
  readonly standingTick: number;
  /** What the clock wraps: `tickLoopOf(transport)`. */
  readonly loop: TickLoop | null;
}

/** Whether pitch class `pc` is in the key's scale (the set `scalePitchClasses` gives). */
function inScale(pc: number, harmony: Harmony): boolean {
  for (const offset of scaleOffsets(harmony.scale)) {
    if (pitchClass(harmony.root + offset) === pc) return true;
  }
  return false;
}

/** Whether `chord` holds pitch class `pc` (the set `tonesOf` gives). */
function inChord(pc: number, harmony: Harmony, chord: HarmonyChord): boolean {
  for (const tone of chord.stack) {
    if (pitchClass(harmony.root + tone) === pc) return true;
  }
  return false;
}

/** Whether the Chord fold's set at `tick` holds `pc`: the chord there, or the scale with none. */
function chordHolds(pc: number, song: FoldSong, tick: number): boolean {
  const chord = chordAt(song.harmony, song.songTicks, tick);
  return chord ? inChord(pc, song.harmony, chord) : inScale(pc, song.harmony);
}

/**
 * Whether a MIDI note-on passes the part's fold (decision 7): always when
 * the part is not folded; against the scale for Scale, or for Chord with no
 * chords, with no window, since that set never changes. For Chord with the
 * transport stopped, the set at the standing tick, with no window, since no
 * change is coming. Running, the set at `stampTick` (the tick the note was
 * heard, as the recorder stamps it), then at each of the grace window's
 * ticks after it, as the clock steps.
 */
export function passes(
  note: number,
  stampTick: number,
  song: FoldSong,
  clock: FoldClock,
  table: KeyboardFoldTable = KEYBOARD_FOLD_TABLE,
): boolean {
  if (song.fold === 'off') return true;
  const pc = pitchClass(note);
  if (song.fold === 'scale' || song.harmony.events.length === 0) return inScale(pc, song.harmony);
  if (!clock.running) return chordHolds(pc, song, clock.standingTick);
  let tick = stampTick;
  if (chordHolds(pc, song, tick)) return true;
  for (let step = 0; step < table.graceTicks; step++) {
    tick = followingTick(tick, clock.loop);
    if (chordHolds(pc, song, tick)) return true;
  }
  return false;
}
