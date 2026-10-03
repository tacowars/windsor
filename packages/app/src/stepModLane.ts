/**
 * Modulation lanes on a step card (windsor#31): the picker that adds one,
 * a lane's name column with its remove × and readout, and one bipolar cell
 * per step for the card to put in its step column, so a lane lines up with
 * the steps by construction. A cell's bar grows up from the centre line for
 * a positive value and down for a negative one; a press or a vertical drag
 * sets it, a drag across cells paints each cell it crosses, a double-click
 * resets it to 0, and a hover reads the step's offset and what it plays.
 * A slide that holds a row draws its cell dashed; one whose hold the run
 * decides (the loop's wrap, a Skip) draws it dotted.
 *
 * Generic over the card: a card hands a `LaneHost` (its lanes, the write
 * through `ctx.change`, its repaint), so the grid carries lanes first and
 * another step kind can reuse this file as is. The Euclid card (windsor#356)
 * draws each lane as a row of its own length with `laneCell`, and may lay a
 * lane out under its hits, so a cell can show another index of the lane
 * (`LaneHost.valueIndex`) and the hover can go to the card's one readout
 * (`LaneHost.say`); the grid leaves both out and draws as before. The rules are
 * `stepModLaneModel.ts`; this file only reads pointers and draws.
 *
 * A press previews on the cells and writes once, at its release, whether
 * it was a click or a drag; a still second press on the same cell inside the
 * double-click window writes the cell's reset instead (`LaneClickGate`).
 * Nothing waits for a later write. A press keeps the pointer captured on the
 * pressed cell, and a cancel, a lost capture, a window blur or a move with
 * the primary button up — a release it never saw — drops the preview (as PR
 * windsor#27's drags do) and writes nothing.
 */
import type { Patch, StepModLane, VoiceTargetPath } from '@windsor/engine';
import { STEP_MOD_LANES_MAX, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { getPath } from './patchPath';
import { primaryHeld } from './songViewTables';
import {
  type PaintPoint,
  type StepSlide,
  NO_SLIDE,
  addLane,
  canAddLane,
  cellAtX,
  freeParams,
  heldBySlide,
  laneLabel,
  laneReadout,
  paintCells,
  removeLane,
  valueAtY,
} from './stepModLaneModel';
import { isDrag } from './stepModLaneClicks';
import { gateOf } from './stepModLaneGates';

/** What a lane needs of the card it sits on. */
export interface LaneHost {
  /** Holds every lane cell and name: where a drag finds its lane's cells and a hover its readout. */
  readonly scope: HTMLElement;
  /** The card's lanes, or null when the part is gone or re-kinded. */
  lanes(): readonly StepModLane[] | null;
  /** The patch's own value at `param`, when the document carries the part's patch. */
  base(param: VoiceTargetPath): number | undefined;
  /** The part's patch, when the document carries it: which macros the picker offers, and their names. */
  patch(): Patch | undefined;
  /** Write a whole lane list through `ctx.change`; true when it took. */
  write(lanes: readonly StepModLane[]): boolean;
  /** Redraw the card from the document. */
  repaint(): void;
  /** The number of written steps: a new lane's length. */
  stepCount(): number;
  /** How step `index`'s note meets the voice; a card without slides leaves it out (`NO_SLIDE`). */
  slide?(index: number): StepSlide;
  /** The value index lane `lane`'s cell `cell` shows; absent, the cell's own index. */
  valueIndex?(lane: number, cell: number): number;
  /** Where a hover's readout goes; absent, the lane's own `.mod-readout` line. Null clears it. */
  say?(lane: number, step: number, text: string | null): void;
  /**
   * What the card's click gate is kept under, for a card that builds a new
   * host on every repaint; absent, the host itself (`stepModLaneGates.ts`).
   */
  readonly gateKey?: object;
}

/** The value index a cell shows: the host's mapping, else the cell's own index. */
const valueAt = (host: LaneHost, lane: number, cell: number): number =>
  host.valueIndex?.(lane, cell) ?? cell;

/** The patch the part on `slot` plays, when the document carries it. */
export function partPatch(ctx: AppCtx, slot: number): Patch | undefined {
  const doc = ctx.model.doc;
  const part = partAt(doc, slot);
  return part ? doc.patches?.[part.preset] : undefined;
}

/** The patch value of `param` for the part on `slot`: what a readout's played value starts from. */
export function patchBase(ctx: AppCtx, slot: number, param: VoiceTargetPath): number | undefined {
  const value = getPath(partPatch(ctx, slot), param);
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
  const param = host.lanes()?.[lane]?.param;
  if (!param) return;
  const slide = host.slide?.(step) ?? NO_SLIDE;
  const text = value === null ? null : laneReadout(param, value, host.base(param), slide);
  if (host.say) return host.say(lane, step, text);
  const line = host.scope.querySelector<HTMLElement>(`.mod-readout[data-lane="${lane}"]`);
  if (line) line.textContent = text === null ? '' : `${step + 1}: ${text}`;
}

/**
 * A press on lane `lane`'s cell `index`: it paints from the cell until the
 * release (where the gate tells a double-click from a drag), or drops the
 * preview if the release never comes.
 */
function pressCell(host: LaneHost, lane: number, index: number, down: PointerEvent): void {
  const param = host.lanes()?.[lane]?.param;
  if (down.button !== 0 || !param) return;
  down.preventDefault();
  gateOf(host).press(param, valueAt(host, lane, index));
  paintFrom(host, lane, index, down);
}

function paintFrom(host: LaneHost, lane: number, index: number, down: PointerEvent): void {
  const cell = down.currentTarget as HTMLElement;
  const start = host.lanes()?.[lane];
  if (!start) return;
  const cells = cellsOf(host.scope, lane);
  const map = cells.map((_, i) => valueAt(host, lane, i));
  const pressed = map[index] ?? index;
  const spans = cells.map((c) => c.getBoundingClientRect());
  const { top, height } = cell.getBoundingClientRect();
  let values = [...start.values];
  let last: PaintPoint | null = null;
  let dragged = false;
  const paint = (e: PointerEvent): void => {
    dragged ||= isDrag(e.clientX - down.clientX, e.clientY - down.clientY);
    const to = { index: cellAtX(e.clientX, spans), value: valueAtY(e.clientY, { top, height }) };
    values = paintCells(values, map, last, to);
    last = to;
    cells.forEach((c, i) => drawCell(c, values[map[i] ?? i] ?? 0));
    const at = map[to.index] ?? to.index;
    showReadout(host, lane, at, values[at] ?? 0);
  };
  const stop = new AbortController();
  const finish = (commit: boolean): void => {
    if (stop.signal.aborted) return;
    stop.abort();
    if (cell.hasPointerCapture(down.pointerId)) cell.releasePointerCapture(down.pointerId);
    if (!commit) return host.repaint();
    if (gateOf(host).release(start.param, pressed, values, dragged) === 'reset') {
      cells.forEach((c, i) => {
        const at = map[i] ?? i;
        drawCell(c, at === pressed ? 0 : (values[at] ?? 0));
      });
      showReadout(host, lane, pressed, 0);
    }
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
 * cell a slide holds (`heldBySlide`) draws dashed with its bar in the rule
 * colour, since its value is kept for when the slide goes but does not
 * play, and one the run decides draws dotted.
 */
export function laneCells(host: LaneHost, index: number, sounds = true): HTMLElement[] {
  return (host.lanes() ?? []).map((_, k) => laneCell(host, k, index, sounds));
}

/**
 * Lane `k`'s cell `index`, drawn and wired as `laneCells` draws each: what a
 * card that lays its lanes out as rows (the Euclid card) appends per cell.
 * The cell shows the lane's value at `valueIndex(k, index)`.
 */
export function laneCell(host: LaneHost, k: number, index: number, sounds = true): HTMLElement {
  const lane = host.lanes()?.[k];
  const cell = el('div', k === 0 ? 'mod-cell first' : 'mod-cell');
  if (!lane) return cell;
  const at = valueAt(host, k, index);
  cell.dataset.lane = String(k);
  cell.classList.toggle('mute', !sounds);
  const hold = heldBySlide(host.slide?.(index) ?? NO_SLIDE, lane.param);
  cell.classList.toggle('held', hold === 'held');
  cell.classList.toggle('depends', hold === 'depends');
  cell.setAttribute('aria-label', `${laneLabel(lane.param, host.patch())} step ${at + 1}`);
  cell.appendChild(el('div', 'mod-bar'));
  drawCell(cell, lane.values[at] ?? 0);
  cell.addEventListener('pointerdown', (e) => pressCell(host, k, index, e));
  cell.addEventListener('pointermove', (e) => {
    if (e.buttons === 0) showReadout(host, k, at, host.lanes()?.[k]?.values[at] ?? 0);
  });
  cell.addEventListener('pointerleave', () => showReadout(host, k, at, null));
  return cell;
}

/** Fill the name column: one row per lane, level with its cells, with its × and its readout line. */
export function paintLaneNames(names: HTMLElement, host: LaneHost): void {
  names.innerHTML = '';
  const lanes = host.lanes() ?? [];
  names.hidden = lanes.length === 0;
  const patch = host.patch();
  lanes.forEach((lane, k) => {
    const row = el('div', 'mod-name');
    const head = el('div', 'mod-head');
    const label = laneLabel(lane.param, patch);
    head.appendChild(el('span', 'mod-title', label));
    const remove = el('button', 'mod-x', '×') as HTMLButtonElement;
    remove.type = 'button';
    remove.title = `Remove the ${label} lane`;
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
    const param = select.value as VoiceTargetPath;
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
  const patch = host.patch();
  if (open) {
    for (const param of freeParams(lanes, patch)) {
      select.add(new Option(laneLabel(param, patch), param));
    }
  }
  select.value = '';
  select.disabled = !open;
}
