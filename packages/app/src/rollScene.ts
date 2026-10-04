/**
 * Everything one paint of the Roll draws (windsor#602), gathered from the
 * document and the view without the DOM: the rows, the scale, the region's
 * length and the loop, the chord strip, the notes, and the px a
 * tick takes. The DOM files only place what this hands them.
 */
import type { Harmony, RollNote } from '@windsor/engine';
import { PPQ } from '@windsor/engine';
import { type ChordSpan, chordSpans, scalePitchClasses } from './rollHarmony';
import type { SongPlace } from './rollNoteLook';
import { type RollKeys, type RollRow, type RowLayout, rollRows } from './rollRows';

/** What the scene is built from. */
export interface SceneInput {
  readonly notes: readonly RollNote[];
  readonly loopTicks: number;
  readonly regionStart: number;
  readonly regionTicks: number;
  readonly barTicks: number;
  readonly snapTicks: number;
  readonly harmony: Harmony;
  readonly songTicks: number;
  readonly keys: RollKeys;
  readonly fold: boolean;
  readonly rowPx: number;
  /** The notes pane's height, which Fold fills. */
  readonly panePx: number;
  readonly beatPx: number;
}

/** One paint's worth of the roll. */
export interface RollScene {
  readonly notes: readonly RollNote[];
  readonly rows: RowLayout;
  readonly rowByPitch: ReadonlyMap<number, RollRow>;
  readonly scalePcs: ReadonlySet<number>;
  readonly spans: readonly ChordSpan[];
  readonly place: SongPlace;
  /** The loop as drawn: never past the region. */
  readonly loopTicks: number;
  readonly regionTicks: number;
  readonly barTicks: number;
  readonly snapTicks: number;
  readonly pxPerTick: number;
  /** The notes pane's content width. */
  readonly width: number;
}

/** The scene for `input`. */
export function rollScene(input: SceneInput): RollScene {
  const scalePcs = scalePitchClasses(input.harmony);
  const used = new Set(input.notes.map((note) => note.pitch));
  const rows = rollRows({
    keys: input.keys,
    fold: input.fold,
    rowPx: input.rowPx,
    used,
    scalePcs,
    panePx: input.panePx,
  });
  const pxPerTick = input.beatPx / PPQ;
  return {
    notes: input.notes,
    rows,
    rowByPitch: new Map(rows.rows.map((row) => [row.pitch, row])),
    scalePcs,
    spans: chordSpans(input.harmony, input.songTicks, input.regionStart, input.regionTicks),
    place: {
      harmony: input.harmony,
      songTicks: input.songTicks,
      regionStart: input.regionStart,
    },
    loopTicks: Math.min(input.loopTicks, input.regionTicks),
    regionTicks: input.regionTicks,
    barTicks: input.barTicks,
    snapTicks: input.snapTicks,
    pxPerTick,
    width: input.regionTicks * pxPerTick,
  };
}

/** The bars the ruler numbers: every bar the region starts, the last perhaps cut short. */
export const barCount = (regionTicks: number, barTicks: number): number =>
  Math.max(1, Math.ceil(regionTicks / barTicks));

/** The pitch a view opens centred on: the notes' mean, or `empty` for a roll with none. */
export function centrePitch(notes: readonly RollNote[], empty: number): number {
  if (notes.length === 0) return empty;
  return notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length;
}
