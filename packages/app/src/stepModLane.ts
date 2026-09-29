/**
 * Modulation lanes on a step card (windsor#31): the picker that adds one,
 * a lane's name column with its remove × and readout, and one bipolar cell
 * per step for the card to put in its step column, so a lane lines up with
 * the steps by construction. A cell's bar grows up from the centre line for
 * a positive value and down for a negative one; a press or a vertical drag
 * sets it, a drag across cells paints each cell it crosses, a double-click
 * resets it to 0, and a hover reads the step's offset and what it plays.
 *
 * Generic over the card: a card hands a `LaneHost` (its lanes, the write
 * through `ctx.change`, its repaint), so the grid carries lanes first and
 * another step kind can reuse this file as is. The rules are
 * `stepModLaneModel.ts`; this file only reads pointers and draws.
 *
 * A drag previews on the cells and commits once on release. It keeps the
 * pointer captured on the pressed cell, and a cancel, a lost capture, a
 * window blur or a move with the primary button up — a release it never saw —
 * drops the preview (as PR windsor#27's drags do).
 */
import type { StepModLane, StepModParam } from '@windsor/engine';
import { STEP_MOD_LANES_MAX, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { getPath } from './patchPath';
import { primaryHeld } from './songViewTables';
import {
  type PaintPoint,
  type StepSlide,
  addLane,
  canAddLane,
  cellAtX,
  freeParams,
  heldBySlide,
  laneLabel,
  laneReadout,
  paintSpan,
  removeLane,
  resetCell,
  valueAtY,
  withLaneValues,
} from './stepModLaneModel';

/** What a lane needs of the card it sits on. */
export interface LaneHost {
  /** Holds every lane cell and name: where a drag finds its lane's cells and a hover its readout. */
  readonly scope: HTMLElement;
  /** The card's lanes, or null when the part is gone or re-kinded. */
  lanes(): readonly StepModLane[] | null;
  /** The patch's own value at `param`, when the document carries the part's patch. */
  base(param: StepModParam): number | undefined;
  /** Write a whole lane list through `ctx.change`; true when it took. */
  write(lanes: readonly StepModLane[]): boolean;
  /** Redraw the card from the document. */
  repaint(): void;
  /** The number of written steps: a new lane's length. */
  stepCount(): number;
  /** How step `index`'s note meets the voice; a card without slides leaves it out (`none`). */
  slide?(index: number): StepSlide;
}

/** The patch value of `param` for the part on `slot`: what a readout's played value starts from. */
export function patchBase(ctx: AppCtx, slot: number, param: StepModParam): number | undefined {
  const doc = ctx.model.doc;
  const part = partAt(doc, slot);
  const value = part ? getPath(doc.patches?.[part.preset], param) : undefined;
  return typeof value === 'number' ? value : undefined;
}

const cellsOf = (scope: HTMLElement, lane: number): HTMLElement[] =>
  Array.from(scope.querySelectorAll<HTMLElement>(`.mod-cell[data-lane="${lane}"]`));

function drawCell(cell: HTMLElement, value: number): void {
  cell.style.setProperty('--mag', String(Math.abs(value)));
  cell.classList.toggle('neg', value < 0);
  cell.classList.toggle('zero', value === 0);
}

function showReadout(host: LaneHost, lane: number, step: number, value: number | null): void {
  const line = host.scope.querySelector<HTMLElement>(`.mod-readout[data-lane="${lane}"]`);
  const param = host.lanes()?.[lane]?.param;
  if (!line || !param) return;
  const slide = host.slide?.(step) ?? 'none';
  line.textContent =
    value === null ? '' : `${step + 1}: ${laneReadout(param, value, host.base(param), slide)}`;
}

/** A press on lane `lane`'s cell: paint from it until the release, or drop the preview. */
function paintFrom(host: LaneHost, lane: number, cell: HTMLElement, down: PointerEvent): void {
  const start = host.lanes()?.[lane];
  if (down.button !== 0 || !start) return;
  down.preventDefault();
  const cells = cellsOf(host.scope, lane);
  const spans = cells.map((c) => c.getBoundingClientRect());
  const { top, height } = cell.getBoundingClientRect();
  let values = [...start.values];
  let last: PaintPoint | null = null;
  const paint = (e: PointerEvent): void => {
    const to = { index: cellAtX(e.clientX, spans), value: valueAtY(e.clientY, { top, height }) };
    values = paintSpan(values, last, to);
    last = to;
    cells.forEach((c, i) => drawCell(c, values[i] ?? 0));
    showReadout(host, lane, to.index, values[to.index] ?? 0);
  };
  const stop = new AbortController();
  const finish = (commit: boolean): void => {
    if (stop.signal.aborted) return;
    stop.abort();
    if (cell.hasPointerCapture(down.pointerId)) cell.releasePointerCapture(down.pointerId);
    const lanes = host.lanes();
    if (!commit || !lanes || !host.write(withLaneValues(lanes, lane, values))) host.repaint();
  };
  const mine = (e: PointerEvent): boolean => e.pointerId === down.pointerId;
  const on = { signal: stop.signal };
  cell.addEventListener(
    'pointermove',
    (e) => {
      if (!mine(e)) return;
      if (primaryHeld(e.buttons)) paint(e);
      else finish(false);
    },
    on,
  );
  cell.addEventListener('pointerup', (e) => mine(e) && finish(true), on);
  for (const type of ['pointercancel', 'lostpointercapture'] as const) {
    cell.addEventListener(type, (e) => mine(e) && finish(false), on);
  }
  window.addEventListener('blur', () => finish(false), on);
  try {
    cell.setPointerCapture(down.pointerId);
  } catch {
    // A pointer the browser does not track (a synthetic event): the drag runs on the cell's own events.
  }
  paint(down);
}

/**
 * Step `index`'s cells, one per lane in lane order, for the card to append
 * to that step's column. `sounds` false dims a step no note plays on; a
 * cell a slide holds (`heldBySlide`) draws its bar in the rule colour, since
 * its value is kept for when the slide goes but does not play.
 */
export function laneCells(host: LaneHost, index: number, sounds = true): HTMLElement[] {
  return (host.lanes() ?? []).map((lane, k) => {
    const cell = el('div', k === 0 ? 'mod-cell first' : 'mod-cell');
    cell.dataset.lane = String(k);
    cell.classList.toggle('mute', !sounds);
    cell.classList.toggle('held', heldBySlide(host.slide?.(index) ?? 'none', lane.param));
    cell.setAttribute('aria-label', `${laneLabel(lane.param)} step ${index + 1}`);
    cell.appendChild(el('div', 'mod-bar'));
    drawCell(cell, lane.values[index] ?? 0);
    cell.addEventListener('pointerdown', (e) => paintFrom(host, k, cell, e));
    cell.addEventListener('pointermove', (e) => {
      if (e.buttons === 0) showReadout(host, k, index, host.lanes()?.[k]?.values[index] ?? 0);
    });
    cell.addEventListener('pointerleave', () => showReadout(host, k, index, null));
    cell.addEventListener('dblclick', () => {
      const lanes = host.lanes();
      const values = lanes?.[k] && resetCell(lanes[k].values, index);
      if (!lanes || !values || !host.write(withLaneValues(lanes, k, values))) return host.repaint();
      drawCell(cell, 0);
      showReadout(host, k, index, 0);
    });
    return cell;
  });
}

/** Fill the name column: one row per lane, level with its cells, with its × and its readout line. */
export function paintLaneNames(names: HTMLElement, host: LaneHost): void {
  names.innerHTML = '';
  const lanes = host.lanes() ?? [];
  names.hidden = lanes.length === 0;
  lanes.forEach((lane, k) => {
    const row = el('div', 'mod-name');
    const head = el('div', 'mod-head');
    head.appendChild(el('span', 'mod-title', laneLabel(lane.param)));
    const remove = el('button', 'mod-x', '×') as HTMLButtonElement;
    remove.type = 'button';
    remove.title = `Remove the ${laneLabel(lane.param)} lane`;
    remove.onclick = (): void => {
      const now = host.lanes();
      if (now && host.write(removeLane(now, k))) host.repaint();
    };
    head.appendChild(remove);
    row.appendChild(head);
    const readout = el('div', 'mod-readout');
    readout.dataset.lane = String(k);
    row.appendChild(readout);
    names.appendChild(row);
  });
}

/** The add-lane picker; `fillLanePicker` redraws its choices after every repaint. */
export function lanePicker(host: LaneHost): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'field mod-add';
  select.setAttribute('aria-label', 'add a modulation lane');
  select.onchange = (): void => {
    const lanes = host.lanes();
    const param = select.value as StepModParam;
    const next = lanes && addLane(lanes, param, host.stepCount());
    if (next && host.write(next)) host.repaint();
    else fillLanePicker(select, host);
  };
  fillLanePicker(select, host);
  return select;
}

export function fillLanePicker(select: HTMLSelectElement, host: LaneHost): void {
  const lanes = host.lanes() ?? [];
  const open = canAddLane(lanes);
  select.innerHTML = '';
  select.add(new Option(open ? '+ Lane' : `Lanes full (${STEP_MOD_LANES_MAX})`, ''));
  if (open) for (const param of freeParams(lanes)) select.add(new Option(laneLabel(param), param));
  select.value = '';
  select.disabled = !open;
}
