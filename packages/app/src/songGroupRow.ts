/**
 * A group's folder header on the Song tab (windsor#615; record
 * `2026-10-05-group-automation-folder-tracks`). In the frozen column: the
 * member fold (`▾` open, `▸` folded), the group's name and its member
 * count. In the timeline: the outline of where the group plays, the union
 * of its members' regions as merged, faded spans (`songFolderModel.ts`).
 * The outline is read only: it takes no selection, drag, draw or region,
 * and a press on it does nothing (decision 2).
 *
 * Which groups are folded is view state for the session, as `openParts` is:
 * `closedGroups`, so every group starts open (decision 3). The row order the
 * header sits in is `songRows`; `songLaneColumn.ts` wraps the pair in a row
 * group and indents the members under it.
 */
import type { GroupSpec } from '@windsor/engine';
import { el } from './dom';
import type { GroupRowEntry } from './songFolderModel';
import { memberCountLabel, outlineSpans } from './songFolderModel';
import type { SongView } from './songTab';
import { blockBox } from './songViewTables';

/**
 * The member fold: `▾` with the members shown, `▸` folded. Folding repaints
 * the lanes and keeps the focus on the button across the repaint.
 */
function memberFold(view: SongView, group: GroupSpec): HTMLButtonElement {
  const { closedGroups } = view.state;
  const open = !closedGroups.has(group.id);
  const button = el('button', 'tri', open ? '▾' : '▸') as HTMLButtonElement;
  button.type = 'button';
  button.dataset['focus'] = `group:${group.id}`;
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the parts in ${group.name}`);
  button.onclick = (e): void => {
    e.stopPropagation();
    const grid = button.closest('.lanes');
    if (open) closedGroups.add(group.id);
    else closedGroups.delete(group.id);
    view.paintLanes();
    grid?.querySelector<HTMLElement>(`[data-focus="group:${group.id}"]`)?.focus();
  };
  return button;
}

/** The header's block of the frozen column: the folder tab, then the fold over the name and count. */
function headerBlock(view: SongView, group: GroupSpec, members: number): HTMLElement {
  const block = el('div', 'lane-folder');
  block.title = `${group.name}: a group · ${memberCountLabel(members)}`;
  const tab = el('div', 'folder-tab');
  const row = el('div', 'folder-row');
  const fold = el('div', 'lane-fold');
  fold.appendChild(memberFold(view, group));
  const name = el('span', 'nm');
  name.append(el('b', '', group.name), el('small', '', `group · ${memberCountLabel(members)}`));
  row.append(fold, name);
  block.append(tab, row);
  return block;
}

/** The outline lane: one faded span per stretch where any member plays. */
function outlineLane(view: SongView, members: readonly number[]): HTMLElement {
  const lane = el('div', 'lane lane-outline');
  lane.title = 'where the group’s parts play · edit regions on the parts’ own lanes';
  const { doc } = view.ctx.model;
  const regions = members.map((slot) => doc.parts.find((p) => p.slot === slot)?.regions ?? []);
  const bar = view.ticksPerBar();
  for (const span of outlineSpans(regions, view.songTicks())) {
    const box = blockBox(span.start, span.duration, view.state.pxPerBar, bar);
    const node = el('div', 'fspan');
    node.style.left = `${box.leftPx}px`;
    node.style.width = `${box.widthPx}px`;
    lane.appendChild(node);
  }
  return lane;
}

/** The group's header row: its block of the frozen column and its outline lane. Null for a group the song lacks. */
export function groupRow(view: SongView, row: GroupRowEntry): [HTMLElement, HTMLElement] | null {
  const group = view.ctx.model.doc.groups?.find((g) => g.id === row.id);
  if (!group) return null;
  return [headerBlock(view, group, row.members.length), outlineLane(view, row.members)];
}
