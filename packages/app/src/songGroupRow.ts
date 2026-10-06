/**
 * A group's folder header on the Song tab (windsor#615; record
 * `2026-10-05-group-automation-folder-tracks`). In the frozen column: the
 * member fold (`▾` open, `▸` folded), the lanes fold, and the group's name
 * and member count. In the timeline: the outline of where the group plays,
 * the union of its members' regions as merged, faded spans
 * (`songFolderModel.ts`). The outline is read only: it takes no selection,
 * drag, draw or region, and a press on it does nothing (decision 2).
 *
 * The lanes fold (windsor#616 decision 1) opens the group's own automation
 * lanes beneath the header and above its members: the part's lane rows
 * (`songAutomationLane.ts`) with the group as their owner, their curves
 * ghosted over the outline. Folded, it shows the lane count, as a part's
 * `▸` does. The two folds are independent: folding the members leaves the
 * lanes as they are, and folding the lanes leaves the members.
 *
 * Which groups are folded is view state for the session, as `openParts` is:
 * `closedGroups` for the members, so every group starts open (decision 3),
 * and `openGroups` for the lanes, so every group's lanes start folded. The
 * row order the header sits in is `songRows`; `songLaneColumn.ts` wraps the
 * header in a row group and indents the members under it.
 */
import type { GroupSpec, Region } from '@windsor/engine';
import { el } from './dom';
import type { Readout } from './songAutomationLane';
import { automationRows } from './songAutomationLane';
import { laneCountLabel } from './songAutomationModel';
import type { GroupRowEntry } from './songFolderModel';
import { LANES_CAPTION, memberCountLabel, outlineSpans } from './songFolderModel';
import type { SongView } from './songTab';
import { blockBox, partBlockRows } from './songViewTables';

/** A fold button: `▾` open, `▸` folded; a press flips `open` and repaints, keeping the focus on it. */
function foldButton(
  view: SongView,
  fold: { readonly open: boolean; readonly focus: string; readonly label: string },
  flip: () => void,
): HTMLButtonElement {
  const button = el('button', 'tri', fold.open ? '▾' : '▸') as HTMLButtonElement;
  button.type = 'button';
  button.dataset['focus'] = fold.focus;
  button.setAttribute('aria-expanded', String(fold.open));
  button.setAttribute('aria-label', fold.label);
  button.title = fold.label;
  button.onclick = (e): void => {
    e.stopPropagation();
    const grid = button.closest('.lanes');
    flip();
    view.paintLanes();
    grid?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(fold.focus)}"]`)?.focus();
  };
  return button;
}

/** The member fold (windsor#615): shows or hides the parts under the header. */
function memberFold(view: SongView, group: GroupSpec): HTMLElement {
  const { closedGroups } = view.state;
  const open = !closedGroups.has(group.id);
  const label = `${open ? 'Hide' : 'Show'} the parts in ${group.name}`;
  const button = foldButton(view, { open, focus: `group:${group.id}`, label }, () => {
    if (open) closedGroups.add(group.id);
    else closedGroups.delete(group.id);
  });
  const fold = el('div', 'lane-fold');
  fold.appendChild(button);
  return fold;
}

/**
 * The lanes fold (windsor#616 decision 1): `▸` beside "lanes", or beside
 * the lane count while folded with lanes, as a part's fold shows its badge.
 */
function lanesFold(view: SongView, group: GroupSpec): HTMLElement {
  const { openGroups } = view.state;
  const open = openGroups.has(group.id);
  const label = `${open ? 'Hide' : 'Show'} automation for ${group.name}`;
  const button = foldButton(view, { open, focus: `lanes:group:${group.id}`, label }, () => {
    if (open) openGroups.delete(group.id);
    else openGroups.add(group.id);
  });
  const fold = el('div', 'lane-fold folder-lanes');
  const count = group.automation?.length ?? 0;
  const badge = !open && count > 0;
  fold.append(
    button,
    el(
      'span',
      badge ? 'auto-badge' : 'fold-caption',
      badge ? laneCountLabel(count) : LANES_CAPTION,
    ),
  );
  return fold;
}

/** The header's row: the two folds, then the name over the member count. */
function headerRow(view: SongView, group: GroupSpec, members: number): HTMLElement {
  const row = el('div', 'folder-row');
  row.title = `${group.name}: a group · ${memberCountLabel(members)}`;
  const name = el('span', 'nm');
  name.append(el('b', '', group.name), el('small', '', `group · ${memberCountLabel(members)}`));
  row.append(memberFold(view, group), lanesFold(view, group), name);
  return row;
}

/** The outline lane: one faded span per stretch where any member plays. */
function outlineLane(view: SongView, spans: readonly Region[]): HTMLElement {
  const lane = el('div', 'lane lane-outline');
  lane.title = 'where the group’s parts play · edit regions on the parts’ own lanes';
  const bar = view.ticksPerBar();
  for (const span of spans) {
    const box = blockBox(span.start, span.duration, view.state.pxPerBar, bar);
    const node = el('div', 'fspan');
    node.style.left = `${box.leftPx}px`;
    node.style.width = `${box.widthPx}px`;
    lane.appendChild(node);
  }
  return lane;
}

/** The header's block of the frozen column and its rows of timeline. */
export interface GroupRowCells {
  readonly frozen: HTMLElement;
  readonly timeline: readonly HTMLElement[];
}

/**
 * The group's header: its block of the frozen column (the folder tab down
 * every row, the header's row, and while its lanes are open a label per
 * lane and the add row) beside its outline lane and its curves. Each open
 * lane that plays pushes its value cell onto `readouts`. Null for a group
 * the song lacks.
 */
export function groupRow(
  view: SongView,
  row: GroupRowEntry,
  readouts: Readout[],
): GroupRowCells | null {
  const { doc } = view.ctx.model;
  const group = doc.groups?.find((g) => g.id === row.id);
  if (!group) return null;
  const regions = row.members.map((slot) => doc.parts.find((p) => p.slot === slot)?.regions ?? []);
  const spans = outlineSpans(regions, view.songTicks());
  const open = view.state.openGroups.has(group.id);
  const lanes = open ? automationRows(view, group, readouts, spans) : [];
  const block = el('div', 'lane-folder');
  const tab = el('div', 'folder-tab');
  tab.style.gridRow = `1 / span ${partBlockRows(open, group.automation?.length ?? 0).length}`;
  block.append(tab, headerRow(view, group, row.members.length), ...lanes.map((r) => r.label));
  return { frozen: block, timeline: [outlineLane(view, spans), ...lanes.map((r) => r.timeline)] };
}
