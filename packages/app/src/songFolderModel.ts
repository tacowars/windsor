/**
 * The Song tab's folder tracks (windsor#615; record
 * `2026-10-05-group-automation-folder-tracks`): the order its part rows and
 * group headers are drawn in, which of them a folded group hides, and the
 * outline a header's lane draws. Display only: the document and the slots
 * never change.
 *
 * A group's members are the parts whose strip Output is `{ group: id }`, in
 * slot order under its header. Ungrouped parts (Master or Sidechain) stay
 * in slot order; each group's header takes the place of its lowest-slot
 * member; groups no part plays through come after every part, in id order
 * (decision 1).
 *
 * A group's header has a second fold for its own automation lanes
 * (windsor#616): whether any open lanes call for the lane toolbar is
 * `lanesOpen`.
 */
import type { ChannelStrip, Region } from '@windsor/engine';
import { isGroupOutput } from '@windsor/engine';

/** What the rows are built from: each part's slot and Output, and the song's group ids. */
export interface FolderDoc {
  readonly parts: readonly {
    readonly slot: number;
    readonly strip: Pick<ChannelStrip, 'output'>;
  }[];
  readonly groups?: readonly { readonly id: number }[];
}

/** A part's row; `group` is the id of the folder it sits in, or null. */
export interface PartRowEntry {
  readonly kind: 'part';
  readonly slot: number;
  readonly group: number | null;
}

/** A group's header row, with its members' slots in slot order. */
export interface GroupRowEntry {
  readonly kind: 'group';
  readonly id: number;
  readonly members: readonly number[];
}

export type SongRow = PartRowEntry | GroupRowEntry;

/** The group a part plays through, if the song has that group. */
function groupOf(output: ChannelStrip['output'], ids: ReadonlySet<number>): number | null {
  return isGroupOutput(output) && ids.has(output.group) ? output.group : null;
}

/** The Song tab's rows, top down, under the harmony lane (decision 1). */
export function songRows(doc: FolderDoc): SongRow[] {
  const ids = new Set((doc.groups ?? []).map((group) => group.id));
  const parts = [...doc.parts].sort((a, b) => a.slot - b.slot);
  const members = new Map<number, number[]>();
  for (const part of parts) {
    const group = groupOf(part.strip.output, ids);
    if (group !== null) members.set(group, [...(members.get(group) ?? []), part.slot]);
  }
  const rows: SongRow[] = [];
  const placed = new Set<number>();
  for (const part of parts) {
    const group = groupOf(part.strip.output, ids);
    if (group === null) {
      rows.push({ kind: 'part', slot: part.slot, group: null });
      continue;
    }
    if (placed.has(group)) continue;
    placed.add(group);
    const slots = members.get(group) ?? [];
    rows.push({ kind: 'group', id: group, members: slots });
    for (const slot of slots) rows.push({ kind: 'part', slot, group });
  }
  const empty = [...ids].filter((id) => !placed.has(id)).sort((a, b) => a - b);
  for (const id of empty) rows.push({ kind: 'group', id, members: [] });
  return rows;
}

/** The rows a fold leaves drawn: a closed group's members go, its header stays (decision 3). */
export const visibleRows = (rows: readonly SongRow[], closed: ReadonlySet<number>): SongRow[] =>
  rows.filter((row) => row.kind === 'group' || row.group === null || !closed.has(row.group));

/**
 * Where a group plays: the union of its members' regions, clipped to the
 * song, sorted, with overlapping and touching regions merged into one span
 * (decision 2).
 */
export function outlineSpans(regions: readonly (readonly Region[])[], songTicks: number): Region[] {
  const clipped = regions
    .flat()
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(songTicks, r.start + r.duration) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const span of clipped) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged.map(({ start, end }) => ({ start, duration: end - start }));
}

/** The header's member count: "no parts", "1 part", "3 parts". */
export function memberCountLabel(count: number): string {
  if (count === 0) return 'no parts';
  return count === 1 ? '1 part' : `${count} parts`;
}

/**
 * Bring a fold set up to the document after a change. A different song
 * (`reopened`, `DocumentModel.open`) clears it wholesale, since its group
 * ids name unrelated groups; any other change drops only the ids the song
 * no longer has, so a new group reusing one starts at the default: members
 * shown (`closedGroups`), lanes folded (`openGroups`, windsor#616).
 */
export function refreshGroupFolds(
  folds: Set<number>,
  groups: readonly { id: number }[],
  reopened: boolean,
): void {
  if (reopened) {
    folds.clear();
    return;
  }
  const ids = new Set(groups.map((group) => group.id));
  for (const id of [...folds]) if (!ids.has(id)) folds.delete(id);
}

/** What `followGroupFolds` watches: the document, its change feed and its open count (`DocumentModel`). */
export interface GroupFoldSource {
  readonly doc: { readonly groups?: readonly { readonly id: number }[] };
  readonly openings: number;
  onChange(listener: () => void): () => void;
}

/**
 * Follow the folds on the document change itself, not on the Song tab's
 * next repaint: only the shown tab draws, and a group added while the tab
 * is hidden may reuse the id (`nextGroupId`), so a repaint after both would
 * hand it the old group's folds. Opening another song resets them all.
 * Returns the unsubscribe.
 */
export function followGroupFolds(
  source: GroupFoldSource,
  folds: readonly Set<number>[],
): () => void {
  let openings = source.openings;
  return source.onChange(() => {
    const reopened = source.openings !== openings;
    openings = source.openings;
    for (const set of folds) refreshGroupFolds(set, source.doc.groups ?? [], reopened);
  });
}

/** The lanes fold's caption under its `▸` while it shows no lane count (windsor#616 decision 1). */
export const LANES_CAPTION = 'lanes';

/** Which parts (by slot) and which groups (by id) have their automation lanes open. */
export interface OpenLanes {
  readonly parts: ReadonlySet<number>;
  readonly groups: ReadonlySet<number>;
}

/**
 * Whether the lane toolbar shows (windsor#616 decision 5): a drawn part's
 * lanes are open, or a group's. A group's header is always drawn, so its
 * open lanes count while its members are folded away.
 */
export const lanesOpen = (rows: readonly SongRow[], open: OpenLanes): boolean =>
  rows.some((row) => (row.kind === 'part' ? open.parts.has(row.slot) : open.groups.has(row.id)));
