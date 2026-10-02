/**
 * A part's automation lanes on the Song view (windsor#348; record
 * `2026-10-01-song-automation-lanes` decision 13; the mockup
 * `docs/design/automation-lanes-mockup.html`): the rows a part's `▸` folds
 * out beneath it, each in the grid's three columns.
 *
 * - **A lane** is its colour chip, name and kind; its value at the playhead,
 *   an on/off ● and a delete ×; and its curve over the part's ghosted
 *   regions. The toolbar's Edit and Draw tools edit the curve in place
 *   (windsor#349, `songAutomationGesture.ts`), and its Shape tool stamps a
 *   shape over a range (windsor#350, `songShapeRange.ts`).
 * - **The add row** is the "+ Add lane" picker, the voice count against
 *   `FM_LANES_MAX`, and an empty stretch of timeline.
 *
 * Every edit is one `view.commit` inside a named gesture, so it is one undo
 * step. The value readouts are handed back as `Readout`s, which the view's
 * one playhead loop calls with each new tick (decision 7), so a lane's value
 * follows the playhead without a repaint. The rules are
 * `songAutomationModel.ts`, the geometry `songAutomationCurve.ts`.
 */
import type {
  AutomationLane,
  AutomationPoint,
  AutomationTargetId,
  AutomationTargetRow,
  DocumentPart,
} from '@windsor/engine';
import { valueAt } from '@windsor/engine';
import { el } from './dom';
import { withGesture } from './gestureHooks';
import { curveShape } from './songAutomationCurve';
import { withPoints } from './songAutomationEdit';
import { wireLaneEditing } from './songAutomationGesture';
import {
  automationChange,
  currentValue,
  laneActivity,
  laneRow,
  laneTitle,
  lanesOf,
  newLane,
  pickerGroups,
  readout,
  toggledLane,
  voiceCountLabel,
  withLane,
  withoutLane,
} from './songAutomationModel';
import { AUTOMATION_DRAWING, LANE_KIND_COLOR } from './songAutomationTables';
import type { SongView } from './songTab';
import { SONG_VIEW, tickToPx } from './songViewTables';

/** A lane's value cell, set to the lane's value at a song tick. */
export type Readout = (songTick: number) => void;

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Readonly<Record<string, string | number>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** The part as the document holds it now, so an edit never builds on a stale list. */
const livePart = (view: SongView, part: DocumentPart): DocumentPart =>
  view.ctx.model.doc.parts.find((p) => p.slot === part.slot) ?? part;

/** Set `slot`'s lanes as one undo step named `label`, then put the focus back on `focusKey`. */
function commitLanes(
  view: SongView,
  part: DocumentPart,
  lanes: AutomationLane[],
  edit: { readonly label: string; readonly focus?: HTMLElement },
): void {
  const grid = edit.focus?.closest('.lanes');
  const key = edit.focus?.dataset['focus'];
  withGesture(edit.label, () => view.commit(automationChange(part.slot, lanes)));
  if (grid && key) grid.querySelector<HTMLElement>(`[data-focus="${CSS.escape(key)}"]`)?.focus();
}

function miniButton(text: string, label: string, focusKey: string): HTMLButtonElement {
  const button = el('button', 'auto-btn', text) as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.dataset['focus'] = focusKey;
  return button;
}

/** Draw `points` into `box`: the fill, the line and the dots, at the view's zoom. */
function paintCurve(
  view: SongView,
  box: SVGElement,
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
): void {
  const px = view.state.pxPerBar;
  const widthPx = tickToPx(view.songTicks(), px);
  const heightPx = SONG_VIEW.automationLanePx;
  const shape = curveShape(row, points, { widthPx, heightPx, pxPerBar: px });
  box.setAttribute('width', String(widthPx));
  box.setAttribute('height', String(heightPx));
  box.replaceChildren(
    svg('path', { class: 'auto-fill', d: shape.area }),
    svg('path', { class: 'auto-line', d: shape.line }),
    ...shape.dots.map((dot) =>
      svg('circle', { class: 'auto-dot', cx: dot.x, cy: dot.y, r: AUTOMATION_DRAWING.dotRadiusPx }),
    ),
  );
}

/** The lane's curve over the part's regions, ghosted, at the view's zoom, under the toolbar's tools. */
function laneTimeline(view: SongView, part: DocumentPart, lane: AutomationLane): HTMLElement {
  const px = view.state.pxPerBar;
  const timeline = el('div', 'auto-lane');
  for (const region of part.regions) {
    const ghost = el('div', 'auto-ghost');
    ghost.style.left = `${tickToPx(region.start, px)}px`;
    ghost.style.width = `${tickToPx(region.duration, px)}px`;
    timeline.appendChild(ghost);
  }
  const row = laneRow(part, lane.target);
  if (!row) return timeline;
  const box = svg('svg', { 'aria-hidden': 'true' });
  paintCurve(view, box, row, lane.points);
  timeline.appendChild(box);
  const name = laneTitle(part, lane.target).name;
  const points = (): readonly AutomationPoint[] =>
    lanesOf(livePart(view, part)).find((l) => l.target === lane.target)?.points ?? lane.points;
  const commit = (label: string, next: readonly AutomationPoint[]): void => {
    const live = livePart(view, part);
    commitLanes(view, live, withPoints(lanesOf(live), lane.target, next), { label });
  };
  wireLaneEditing({
    view,
    timeline,
    row,
    name,
    points,
    draw: (next) => paintCurve(view, box, row, next),
    commit,
  });
  // The Shape tool's range (windsor#350): a drag selects a range, and the popover stamps it.
  view.shape.attach({
    view,
    key: `${part.slot}:${lane.target}`,
    timeline,
    row,
    name,
    points,
    commit,
  });
  return timeline;
}

/** One lane's three cells: the name, the mixer column's value and buttons, the curve. */
function laneCells(
  view: SongView,
  part: DocumentPart,
  lane: AutomationLane,
  readouts: Readout[],
): HTMLElement[] {
  const title = laneTitle(part, lane.target);
  const activity = laneActivity(part, lane.target);
  const dim = !lane.on || !activity.active;
  const color = LANE_KIND_COLOR[title.kind];
  const name = el('div', 'lane-name auto-name');
  name.title = `${title.name} · ${title.kindLine}`;
  const text = el('span', 'nm');
  text.append(el('b', '', title.name), el('small', '', title.kindLine));
  name.append(el('span', 'auto-chip'), text);

  const mix = el('div', `mix-cell auto-mix${dim ? ' off' : ''}`);
  const value = el('span', 'auto-value');
  const key = `${part.slot}:${lane.target}`;
  const on = miniButton('●', `${title.name} lane on`, `on:${key}`);
  on.classList.toggle('on', lane.on);
  on.setAttribute('aria-pressed', String(lane.on));
  on.title = lane.on ? 'Turn the lane off' : 'Turn the lane on';
  on.onclick = (): void => {
    const live = livePart(view, part);
    const label = `${title.name} lane ${lane.on ? 'off' : 'on'}`;
    commitLanes(view, live, toggledLane(lanesOf(live), lane.target), { label, focus: on });
  };
  const del = miniButton('×', `Delete the ${title.name} lane`, `del:${key}`);
  del.title = 'Delete the lane';
  del.onclick = (): void => {
    const live = livePart(view, part);
    const label = `Delete ${title.name} lane`;
    commitLanes(view, live, withoutLane(lanesOf(live), lane.target), { label });
  };
  const buttons = el('span', 'auto-buttons');
  buttons.append(on, del);
  mix.append(value, buttons);
  const row = laneRow(part, lane.target);
  if (!activity.active) {
    value.textContent = 'inactive';
    value.title = activity.why;
  } else if (!lane.on) value.textContent = 'off';
  else if (row)
    readouts.push((tick) => (value.textContent = readout(row, valueAt(row, lane.points, tick))));

  const timeline = laneTimeline(view, part, lane);
  timeline.classList.toggle('off', dim);
  for (const cell of [name, mix, timeline]) cell.style.setProperty('--lane-c', color);
  return [name, mix, timeline];
}

/** The picker over `pickerGroups`: a pick adds that target's lane, flat at its current value. */
function lanePicker(view: SongView, part: DocumentPart): HTMLSelectElement {
  const picker = document.createElement('select');
  picker.className = 'field compact auto-picker';
  picker.name = `automation-${part.slot}`;
  picker.setAttribute('aria-label', `Add an automation lane to ${part.name}`);
  picker.dataset['focus'] = `add:${part.slot}`;
  picker.add(new Option('+ Add lane', ''));
  for (const group of pickerGroups(part)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const option of group.options) {
      const node = new Option(option.label, option.target);
      node.disabled = option.disabled;
      optgroup.appendChild(node);
    }
    picker.appendChild(optgroup);
  }
  picker.onchange = (): void => {
    if (picker.value === '') return;
    const target = picker.value as AutomationTargetId;
    const live = livePart(view, part);
    const patch = view.ctx.model.doc.patches?.[live.preset];
    const lane = newLane(target, currentValue(live, patch, target), view.songTicks());
    const label = `Add ${laneTitle(live, target).name} lane`;
    commitLanes(view, live, withLane(lanesOf(live), lane), { label, focus: picker });
  };
  return picker;
}

/** The "+ Add lane" row: the picker, the voice count, an empty timeline. */
function addRowCells(view: SongView, part: DocumentPart): HTMLElement[] {
  const name = el('div', 'lane-name auto-add');
  name.appendChild(lanePicker(view, part));
  const count = el('div', 'mix-cell auto-count', voiceCountLabel(lanesOf(part)));
  return [name, count, el('div', 'auto-add-lane')];
}

/**
 * The rows `part` folds out: one per lane, in the document's order, then the
 * add row. Each lane that plays pushes its value cell onto `readouts`.
 */
export function automationRows(
  view: SongView,
  part: DocumentPart,
  readouts: Readout[],
): HTMLElement[] {
  return [
    ...lanesOf(part).flatMap((lane) => laneCells(view, part, lane, readouts)),
    ...addRowCells(view, part),
  ];
}
