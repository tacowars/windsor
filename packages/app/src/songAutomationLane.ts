/**
 * A part's automation lanes on the Song view (windsor#348; record
 * `2026-10-01-song-automation-lanes` decision 13; the mockup
 * `docs/design/automation-lanes-mockup.html`): the rows a part's `▸` folds
 * out beneath it, each a label in the frozen column and a stretch of
 * timeline (windsor#534). A group bus's folder header folds out the same
 * rows for the group's own lanes (windsor#616): the rows take a lane owner,
 * a part or a group (`songAutomationOwner.ts`), and a group's curves sit
 * over the outline of where its members play.
 *
 * - **A lane** is its colour chip, name and kind, beside its value at the
 *   playhead over an on/off ● and a delete ×; and its curve over the part's
 *   ghosted regions. The toolbar's Edit and Draw tools edit the curve in place
 *   (windsor#349, `songAutomationGesture.ts`), and its Shape tool stamps a
 *   shape over a range (windsor#350, `songShapeRange.ts`).
 * - **The add row** is the "+ Add lane" picker beside the voice count
 *   against `FM_LANES_MAX` (a part's only: a group has no voice), and an
 *   empty stretch of timeline.
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
  Patch,
  Region,
} from '@windsor/engine';
import { valueAt } from '@windsor/engine';
import { readout } from './automationReadout';
import { el } from './dom';
import { withGesture } from './gestureHooks';
import { curveShape } from './songAutomationCurve';
import { withPoints } from './songAutomationEdit';
import { wireLaneEditing } from './songAutomationGesture';
import {
  currentValue,
  laneActivity,
  laneRow,
  laneTitle,
  lanesOf,
  newLane,
  pickerGroups,
  toggledLane,
  voiceCountLabel,
  withLane,
  withoutLane,
} from './songAutomationModel';
import type { LaneOwner } from './songAutomationOwner';
import {
  isGroupLaneOwner,
  liveOwner,
  ownerAutomationChange,
  ownerKey,
} from './songAutomationOwner';
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

/** The owner as the document holds it now, so an edit never builds on a stale list. */
const liveOf = (view: SongView, owner: LaneOwner): LaneOwner =>
  liveOwner(view.ctx.model.doc, owner);

/** The patch a part plays, from the document: what names its macros (windsor#559). A group plays none. */
const patchOf = (view: SongView, owner: LaneOwner): Patch | undefined =>
  isGroupLaneOwner(owner) ? undefined : view.ctx.model.doc.patches?.[owner.preset];

/** Set the owner's lanes as one undo step named `label`, then put the focus back on `focus`. */
function commitLanes(
  view: SongView,
  owner: LaneOwner,
  lanes: AutomationLane[],
  edit: { readonly label: string; readonly focus?: HTMLElement },
): void {
  const grid = edit.focus?.closest('.lanes');
  const key = edit.focus?.dataset['focus'];
  withGesture(edit.label, () => view.commit(ownerAutomationChange(owner, lanes)));
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
  const bar = view.ticksPerBar();
  const widthPx = tickToPx(view.songTicks(), px, bar);
  const heightPx = SONG_VIEW.automationLanePx;
  const shape = curveShape(row, points, { widthPx, heightPx, pxPerBar: px, ticksPerBar: bar });
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

/**
 * The lane's curve over `ghosts` (the part's regions, or where a group's
 * members play), ghosted, at the view's zoom, under the toolbar's tools.
 */
function laneTimeline(
  view: SongView,
  owner: LaneOwner,
  lane: AutomationLane,
  ghosts: readonly Region[],
): HTMLElement {
  const px = view.state.pxPerBar;
  const bar = view.ticksPerBar();
  const timeline = el('div', 'auto-lane');
  for (const region of ghosts) {
    const ghost = el('div', 'auto-ghost');
    ghost.style.left = `${tickToPx(region.start, px, bar)}px`;
    ghost.style.width = `${tickToPx(region.duration, px, bar)}px`;
    timeline.appendChild(ghost);
  }
  const row = laneRow(owner, lane.target, patchOf(view, owner));
  if (!row) return timeline;
  const box = svg('svg', { 'aria-hidden': 'true' });
  paintCurve(view, box, row, lane.points);
  timeline.appendChild(box);
  const name = row.label;
  const points = (): readonly AutomationPoint[] =>
    lanesOf(liveOf(view, owner)).find((l) => l.target === lane.target)?.points ?? lane.points;
  const commit = (label: string, next: readonly AutomationPoint[]): void => {
    const live = liveOf(view, owner);
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
    key: `${ownerKey(owner)}:${lane.target}`,
    timeline,
    row,
    name,
    points,
    commit,
  });
  return timeline;
}

/** A row in the frozen column and its stretch of timeline. */
export interface LaneRowCells {
  readonly label: HTMLElement;
  readonly timeline: HTMLElement;
}

/** Where a lane's cells go: the readouts the playhead sets, and the stretches its curve is ghosted over. */
interface LaneSinks {
  readonly readouts: Readout[];
  readonly ghosts: readonly Region[];
}

/** The lane's ● and ×: switch it on or off, delete it; each one undo step. */
function laneButtons(view: SongView, owner: LaneOwner, lane: AutomationLane): HTMLElement {
  const name = laneTitle(owner, lane.target, patchOf(view, owner)).name;
  const key = `${ownerKey(owner)}:${lane.target}`;
  const on = miniButton('●', `${name} lane on`, `on:${key}`);
  on.classList.toggle('on', lane.on);
  on.setAttribute('aria-pressed', String(lane.on));
  on.title = lane.on ? 'Turn the lane off' : 'Turn the lane on';
  on.onclick = (): void => {
    const live = liveOf(view, owner);
    const label = `${name} lane ${lane.on ? 'off' : 'on'}`;
    commitLanes(view, live, toggledLane(lanesOf(live), lane.target), { label, focus: on });
  };
  const del = miniButton('×', `Delete the ${name} lane`, `del:${key}`);
  del.title = 'Delete the lane';
  del.onclick = (): void => {
    const live = liveOf(view, owner);
    const label = `Delete ${name} lane`;
    commitLanes(view, live, withoutLane(lanesOf(live), lane.target), { label });
  };
  const buttons = el('span', 'auto-buttons');
  buttons.append(on, del);
  return buttons;
}

/**
 * One lane's label and curve. The label (windsor#534 decision 3) is its
 * colour chip, its name over its kind, and beside them its value at the
 * playhead over ● and ×.
 */
function laneCells(
  view: SongView,
  owner: LaneOwner,
  lane: AutomationLane,
  sinks: LaneSinks,
): LaneRowCells {
  const title = laneTitle(owner, lane.target, patchOf(view, owner));
  const activity = laneActivity(owner, lane.target);
  const dim = !lane.on || !activity.active;
  const color = LANE_KIND_COLOR[title.kind];
  const label = el('div', `lane-auto${dim ? ' off' : ''}`);
  label.title = `${title.name} · ${title.kindLine}`;
  const text = el('span', 'nm');
  text.append(el('b', '', title.name), el('small', '', title.kindLine));
  const side = el('span', 'auto-side');
  label.append(el('span', 'auto-chip'), text, side);
  const value = el('span', 'auto-value');
  side.append(value, laneButtons(view, owner, lane));
  const row = laneRow(owner, lane.target, patchOf(view, owner));
  if (!activity.active) {
    value.textContent = 'inactive';
    value.title = activity.why;
  } else if (!lane.on) value.textContent = 'off';
  else if (row) {
    sinks.readouts.push(
      (tick) => (value.textContent = readout(row, valueAt(row, lane.points, tick))),
    );
  }
  const timeline = laneTimeline(view, owner, lane, sinks.ghosts);
  timeline.classList.toggle('off', dim);
  for (const cell of [label, timeline]) cell.style.setProperty('--lane-c', color);
  return { label, timeline };
}

/** The picker over `pickerGroups`: a pick adds that target's lane, flat at its current value. */
function lanePicker(view: SongView, owner: LaneOwner): HTMLSelectElement {
  const picker = document.createElement('select');
  picker.className = 'field compact auto-picker';
  picker.name = `automation-${ownerKey(owner)}`;
  picker.setAttribute('aria-label', `Add an automation lane to ${owner.name}`);
  picker.dataset['focus'] = `add:${ownerKey(owner)}`;
  picker.add(new Option('+ Add lane', ''));
  for (const group of pickerGroups(owner, patchOf(view, owner))) {
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
    const live = liveOf(view, owner);
    const patch = patchOf(view, live);
    const lane = newLane(target, currentValue(live, patch, target), view.songTicks());
    const label = `Add ${laneTitle(live, target, patch).name} lane`;
    commitLanes(view, live, withLane(lanesOf(live), lane), { label, focus: picker });
  };
  return picker;
}

/** The "+ Add lane" row: the picker and a part's voice count side by side, over an empty timeline. */
function addRowCells(view: SongView, owner: LaneOwner): LaneRowCells {
  const label = el('div', 'lane-add');
  label.append(lanePicker(view, owner));
  if (!isGroupLaneOwner(owner)) {
    label.append(el('span', 'auto-count', voiceCountLabel(lanesOf(owner))));
  }
  return { label, timeline: el('div', 'auto-add-lane') };
}

/**
 * The rows `owner` folds out: one per lane, in the document's order, then the
 * add row. Each lane that plays pushes its value cell onto `readouts`. The
 * curves are ghosted over `ghosts`: a part's own regions unless given (a
 * group's outline, windsor#616).
 */
export function automationRows(
  view: SongView,
  owner: LaneOwner,
  readouts: Readout[],
  ghosts: readonly Region[] = isGroupLaneOwner(owner) ? [] : owner.regions,
): LaneRowCells[] {
  return [
    ...lanesOf(owner).map((lane) => laneCells(view, owner, lane, { readouts, ghosts })),
    addRowCells(view, owner),
  ];
}
