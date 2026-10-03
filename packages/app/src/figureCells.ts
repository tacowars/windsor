/**
 * The Figure's step column (windsor#490, look
 * `docs/research/2026-10-03-figure-sequencer/figure.html`): row for row,
 * the tone cell (a click cycles note → tie → rest, a right-click opens the
 * tone picker), Oct (click up, shift-click down), the Vel bar (a vertical
 * drag, 0..1, written on release; a double-click puts it back to 1), A, S
 * and the ratchet, all held at the top of the strip, then the lane cells
 * under them. A rest or a tie keeps the column's height with blank cells
 * and a grey ratchet.
 *
 * A follower's strip draws its leader's cells read-only: the same rows,
 * every cell disabled. The rules are `figureModel.ts`, `gridModel.ts` and
 * `ratchetModel.ts`; this file only reads pointers and draws.
 */
import type { FigureCell } from '@windsor/engine';
import { FIGURE_VEL } from './figureConstants';
import {
  cellLabel,
  cellVelocity,
  dragVelocity,
  nextFigureKind,
  setTone,
  setVelocity,
  toneOptions,
  velocityLabel,
} from './figureModel';
import { openTonePicker } from './figureTonePicker';
import { arpOctaveLabel } from './arpGridModel';
import { cycleOctave, toggleFlag } from './gridModel';
import { ratchetCell } from './ratchetCell';
import { cycleStepRatchet, stepRatchet, takesRatchet } from './ratchetModel';
import { stripCell as cell, stripHeadColumn } from './stepStrip';

/** Apply `edit` to the column's cell as the document holds it, and write it back. */
export type CellEdit = (edit: (cell: FigureCell) => FigureCell) => void;

/** What one column draws. */
export interface FigureColumn {
  readonly index: number;
  readonly cell: FigureCell;
  /** The chord's stack the tone reads over (`HarmonyChord.stack`); a triad with no chord. */
  readonly stack: readonly number[];
  /** False past the stage's (or the line's) length: written, silent this stage. */
  readonly active: boolean;
  /** Null for a follower's borrowed cells, which take no edit. */
  readonly edit: CellEdit | null;
  /** The lane cells under the held rows. */
  readonly under: readonly HTMLElement[];
}

function toneCell(column: FigureColumn): HTMLElement {
  const { cell: step, edit, stack, index } = column;
  const node = cell(cellLabel(step, stack), step.kind === 'note' ? 'note' : '');
  node.setAttribute('aria-label', `Cell ${index + 1}: ${step.kind}`);
  if (!edit) return node;
  node.title =
    step.kind === 'note'
      ? `tone ${step.tone}: click for tie → rest → note, right-click for the tone picker`
      : `${step.kind}: click for the next of note, tie, rest`;
  node.onclick = (): void => edit(nextFigureKind);
  node.oncontextmenu = (e: MouseEvent): void => {
    if (step.kind !== 'note') return;
    e.preventDefault();
    openTonePicker(node, toneOptions(stack), step.tone, (tone) => edit((c) => setTone(c, tone)));
  };
  return node;
}

function octaveCell(column: FigureColumn): HTMLElement {
  const { cell: step, edit } = column;
  if (step.kind !== 'note') return cell('', 'blank');
  const node = cell(arpOctaveLabel(step.octave), step.octave === 0 ? 'oct dim' : 'oct');
  if (!edit) return node;
  node.title = 'octave: click up, shift-click down';
  node.onclick = (e: MouseEvent): void => edit((c) => cycleOctave(c, e.shiftKey ? -1 : 1));
  return node;
}

/** Capture a press on `node`; a pointer the browser does not track (a synthetic event) drags on the node's own events. */
export function capturePointer(node: HTMLElement, pointerId: number): void {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    // Nothing to capture: the drag still runs while the pointer stays on the node.
  }
}

/** Draw the Vel bar at `velocity`: the fill and the value, faint at full. */
function paintVelocity(node: HTMLElement, velocity: number): void {
  const fill = node.querySelector<HTMLElement>('i');
  const text = node.querySelector<HTMLElement>('span');
  if (fill) fill.style.width = `${velocity * FIGURE_VEL.fullPct}%`;
  if (text) text.textContent = velocityLabel(velocity);
  node.classList.toggle('full', velocity >= 1);
  node.setAttribute('aria-valuenow', String(velocity));
}

/** A vertical drag on the Vel bar previews the value and writes it once, on release. */
function wireVelocityDrag(node: HTMLElement, from: number, write: (v: number) => void): void {
  let press: { id: number; y: number; moved: boolean; value: number } | null = null;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    press = { id: e.pointerId, y: e.clientY, moved: false, value: from };
    capturePointer(node, e.pointerId);
  });
  node.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.abs(dy) < FIGURE_VEL.thresholdPx) return;
    press.moved = true;
    press.value = dragVelocity(from, dy);
    paintVelocity(node, press.value);
  });
  const end = (commit: boolean): void => {
    const done = press;
    press = null;
    if (!done) return;
    if (commit && done.moved && done.value !== from) write(done.value);
    else paintVelocity(node, from);
  };
  node.addEventListener('pointerup', () => end(true));
  node.addEventListener('pointercancel', () => end(false));
  node.addEventListener('lostpointercapture', () => end(true));
  node.addEventListener('dblclick', () => write(1));
}

function velocityCell(column: FigureColumn): HTMLElement {
  const { cell: step, edit, index } = column;
  if (step.kind !== 'note') return cell('', 'vel blank');
  const node = cell('', 'vel');
  node.append(document.createElement('i'), document.createElement('span'));
  const velocity = cellVelocity(step);
  node.setAttribute('role', 'slider');
  node.setAttribute('aria-label', `Cell ${index + 1} velocity`);
  node.setAttribute('aria-valuemin', '0');
  node.setAttribute('aria-valuemax', '1');
  paintVelocity(node, velocity);
  if (!edit) return node;
  node.title = `velocity ${velocity.toFixed(2)}: drag up or down, double-click for 1`;
  wireVelocityDrag(node, velocity, (v) => edit((c) => setVelocity(c, v)));
  return node;
}

function flagCell(column: FigureColumn, flag: 'accent' | 'slide'): HTMLElement {
  const { cell: step, edit } = column;
  if (step.kind !== 'note') return cell('', 'blank');
  const node = cell(flag === 'accent' ? 'A' : 'S');
  node.setAttribute('aria-pressed', String(step[flag]));
  if (!edit) return node;
  node.title = flag;
  node.onclick = (): void => edit((c) => toggleFlag(c, flag));
  return node;
}

function ratchet(column: FigureColumn): HTMLElement {
  const { cell: step, edit, index } = column;
  const node = ratchetCell({
    step: index,
    roll: stepRatchet(step),
    takes: takesRatchet(step),
    cycle: () => edit?.(cycleStepRatchet),
  });
  return node;
}

/** Disable every held cell of a borrowed column: it shows the leader's line and takes no edit. */
function borrowed(cells: readonly HTMLElement[]): readonly HTMLElement[] {
  for (const node of cells) {
    if (node instanceof HTMLButtonElement) node.disabled = true;
    node.removeAttribute('title');
  }
  return cells;
}

/** One column: the cell number and the held rows, then the lane cells; dimmed past the stage. */
export function figureColumn(column: FigureColumn): HTMLElement {
  const head = [
    toneCell(column),
    octaveCell(column),
    velocityCell(column),
    flagCell(column, 'accent'),
    flagCell(column, 'slide'),
    ratchet(column),
  ];
  return stripHeadColumn(
    column.index,
    column.active,
    column.edit ? head : borrowed(head),
    column.under,
  );
}
