/**
 * The keyboard's fold as it stands (windsor#919, record
 * `2026-10-18-keyboard-fold` decisions 2 to 5): the part the keyboard plays,
 * its fold and the set it folds to at the tick, and the strip Scale draws
 * under the chord's tones. Pure over the document; the console's host
 * (`consoleFoldHost`) reads the played slot and the playhead, and writes a
 * Fold tap as one undo step.
 *
 * The keys themselves are `keyboardFold.ts`'s (`foldedKeys`); this file
 * only says which set they show now, and gives that a number
 * (`foldSignature`) the frame watch compares, so the keys rebuild only when
 * what they show changes.
 */
import type { ArrangementDocument } from '@windsor/engine';
import { SEMITONES_PER_OCTAVE, chordAt, partAt, songTicksOf } from '@windsor/engine';
import type { AppContext } from './appContext';
import { pitchClass } from './consoleFormat';
import { type FoldMode, type FoldSet, type PartFold, foldSetAt, foldSlots } from './keyboardFold';
import { setPartFoldLive } from './keyboardFoldEdits';
import type { RowSlots } from './keyboardLayout';
import { whiteSlots } from './keyboardLayout';
import { tonesOf } from './rollHarmony';

/** A folded part's keys as they stand: its fold, the set, and the pitch classes Scale strips. */
export interface FoldNow {
  readonly mode: FoldMode;
  readonly set: FoldSet;
  /** Scale only: the chord's tones at the tick (Decided 2). Empty on Chord, or with no chords. */
  readonly strip: ReadonlySet<number>;
}

const NO_STRIP: ReadonlySet<number> = new Set();

/** The fold of the part on `slot` at song tick `tick`; null when it is not folded or gone. */
export function foldNowOf(doc: ArrangementDocument, slot: number, tick: number): FoldNow | null {
  const mode = partAt(doc, slot)?.fold ?? 'off';
  if (mode === 'off') return null;
  const songTicks = songTicksOf(doc);
  const set = foldSetAt(mode, doc.harmony, songTicks, tick);
  const chord = mode === 'scale' ? chordAt(doc.harmony, songTicks, tick) : null;
  return { mode, set, strip: chord ? tonesOf(doc.harmony, chord).chordPcs : NO_STRIP };
}

/** The part's fold as the Fold control shows it. */
export const partFoldOf = (now: FoldNow | null): PartFold => now?.mode ?? 'off';

/** The slots a row of a pick holds: the fold's, or the white keys unfolded. */
export const rowSlotsOf = (now: FoldNow | null): RowSlots =>
  now ? (pick) => foldSlots(now.set.steps.length, pick) : whiteSlots;

/** A set of pitch classes as twelve bits. */
function mask(pcs: Iterable<number>): number {
  let bits = 0;
  for (const pc of pcs) bits |= 1 << pitchClass(pc);
  return bits;
}

/** Where a signature keeps the set's root (after the mode's two bits), its tones and the strip. */
const ROOT_SHIFT = 2;
const ROOT_BITS = 4;
const SET_SHIFT = ROOT_SHIFT + ROOT_BITS;
const STRIP_SHIFT = SET_SHIFT + SEMITONES_PER_OCTAVE;
const MODE_BITS: Readonly<Record<FoldMode, number>> = { scale: 1, chord: 2 };

/** What the keys show as one number: the mode, the set's root and tones. 0 unfolded. */
export function setSignature(now: FoldNow | null): number {
  if (!now) return 0;
  const tones = mask(now.set.steps.map((step) => now.set.firstPc + step));
  return MODE_BITS[now.mode] | (now.set.rootPc << ROOT_SHIFT) | (tones << SET_SHIFT);
}

/** `setSignature` with Scale's strip: a change of either redraws the keys. */
export const foldSignature = (now: FoldNow | null): number =>
  now ? setSignature(now) + mask(now.strip) * 2 ** STRIP_SHIFT : 0;

/** What the keyboard asks of the console about its fold. */
export interface KeyboardFoldHost {
  /** The played part's fold at the tick: the audible playhead while running, else where it stands. */
  now(): FoldNow | null;
  /** Give the played part `fold`, as one undo step. */
  write(fold: PartFold): void;
}

/** The console's fold host: the slot the keyboard plays and Rec records into (`playedSlot`). */
export function consoleFoldHost(ctx: AppContext): KeyboardFoldHost {
  return {
    now: () => foldNowOf(ctx.model.doc, ctx.playedSlot(), ctx.transport.position()),
    write: (fold) => void setPartFoldLive(ctx, ctx.playedSlot(), fold),
  };
}
