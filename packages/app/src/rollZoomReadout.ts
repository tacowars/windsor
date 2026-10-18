/**
 * The readout that shows at the top of the Roll's notes pane while its zoom
 * changes (windsor#903 decision 6; record
 * `2026-10-18-roll-zoom-bars-and-duplicate` decision 7): a gesture, a zoom
 * bar or a Loop or Region press. Time reads as the span shown and the bars
 * it covers, "2 bars · bars 1–2"; rows as the octaves shown, "1½ oct". No
 * px. It hides `ROLL_ZOOM_READOUT.hideMs` after the last change. The words
 * are pure (tested); the box is the Song tab's drag readout (`.readout`).
 */
import { PPQ } from '@windsor/engine';
import { el } from './dom';
import type { RollPanes } from './rollPanes';
import { type RollRow, rowIndexAt } from './rollRows';
import { type ShownBars, shownText } from './rollSummary';
import { ROLL_ZOOM_READOUT, ROLL_ZOOM_TEXT } from './rollTables';

type ReadoutTable = typeof ROLL_ZOOM_READOUT;

const tenth = (v: number, table: ReadoutTable): number =>
  Math.round(v * table.tenths) / table.tenths;

/**
 * A span of `ticks`: in bars from one bar, to a tenth under `wholeBars` and
 * whole from it; under a bar, in beats to a tenth.
 */
export function spanText(
  ticks: number,
  barTicks: number,
  table: ReadoutTable = ROLL_ZOOM_READOUT,
): string {
  const bars = tenth(ticks / barTicks, table);
  if (bars < 1) return ROLL_ZOOM_TEXT.beats(tenth(ticks / PPQ, table));
  return ROLL_ZOOM_TEXT.bars(bars >= table.wholeBars ? Math.round(bars) : bars);
}

/** Time's readout: `2 bars · bars 1–2`. */
export const timeText = (span: string, shown: ShownBars): string =>
  [span, shownText(shown)].join(ROLL_ZOOM_TEXT.join);

/**
 * The octaves the rows from `top` down `heightPx` span: the pitches from the
 * row at the top edge to the row at the bottom edge, both counted, over 12.
 */
export function octavesShown(
  rows: readonly RollRow[],
  view: { top: number; heightPx: number },
  table: ReadoutTable = ROLL_ZOOM_READOUT,
): number {
  if (rows.length === 0 || !(view.heightPx > 0)) return 0;
  const a = rows[rowIndexAt(rows, view.top)] as RollRow;
  const b = rows[rowIndexAt(rows, view.top + view.heightPx - 1)] as RollRow;
  return (Math.abs(a.pitch - b.pitch) + 1) / table.semitones;
}

/** Rows' readout: octaves to the nearest half, `2 oct`, `1½ oct`, `½ oct`. */
export function octaveText(octaves: number, table: ReadoutTable = ROLL_ZOOM_READOUT): string {
  const halves = Math.round(octaves * table.halves);
  const whole = Math.floor(halves / table.halves);
  return ROLL_ZOOM_TEXT.octaves(whole, halves % table.halves !== 0);
}

/** The readout's box over one card's notes pane. */
export class RollZoomReadout {
  readonly root = el('div', 'readout roll-zread');
  private timer = 0;

  constructor(
    private readonly panes: RollPanes,
    private readonly table: ReadoutTable = ROLL_ZOOM_READOUT,
  ) {
    this.root.hidden = true;
  }

  /** Show `text` at the pane's top, its middle at `x` px into the pane (the middle when null), then hide it. */
  show(text: string, x: number | null): void {
    const { body } = this.panes;
    const width = body.clientWidth;
    const edge = Math.min(this.table.edgePx, width / 2);
    const mid = Math.min(width - edge, Math.max(edge, x ?? width / 2));
    this.root.textContent = text;
    this.root.style.left = `${body.offsetLeft + mid}px`;
    this.root.style.top = `${body.offsetTop + this.table.topPx}px`;
    this.root.hidden = false;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.root.hidden = true;
    }, this.table.hideMs);
  }
}
