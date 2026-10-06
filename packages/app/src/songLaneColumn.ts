/**
 * The Song tab's one frozen column (windsor#534; record
 * `2026-10-03-song-tab-one-frozen-column`; the mockup
 * `docs/research/2026-10-03-song-lanes-layout/mockup.html`, layout Proposed
 * with the number tab). The lanes are a stack of row groups, each a block of
 * the frozen column, held at the left while the timeline scrolls, beside
 * that block's rows of timeline:
 *
 * - **the head**: the mixer's header with the ruler's "bar · beat", and
 *   "loop", beside the ruler and the loop strip;
 * - **HARMONY · chords**, beside the harmony lane;
 * - **a part**: its number tab in its colour, its row (`▸`, the lane badge,
 *   its mixer strip), and while it is folded open a label per automation
 *   lane and the add row; beside them its lane of regions, its curves and
 *   the add row's empty stretch.
 *
 * - **a group** (windsor#615): its folder header (`songGroupRow.ts`) beside
 *   the outline of where it plays, then its members' blocks, each inset
 *   with the folder's rail down the inset, in the order `songRows` gives.
 *
 * The part's name and kind are the part strip's (windsor#520), so the
 * column repeats neither. The selected part's block is outlined whole
 * (decision 8), and a press on its tab, its row or a lane label, anywhere
 * but on a control, selects the part, which picks it on the strip too.
 */
import type { DocumentPart } from '@windsor/engine';
import { el } from './dom';
import { groupAccent } from './consoleColors';
import type { LoopBraceRow } from './loopBrace';
import { chipLabel } from './partStripModel';
import { automationRows, type Readout } from './songAutomationLane';
import type { SongRow } from './songFolderModel';
import { groupRow } from './songGroupRow';
import { partLane, partRow, partSelected } from './songLanes';
import type { MixerToggle } from './songMixerCell';
import { EXPANDED_KNOB_COUNT, mixerHeaderCell, partMixerCell } from './songMixerCell';
import type { SongView } from './songTab';
import {
  SONG_VIEW,
  frozenColumnPx,
  mixerColumnPx,
  mixerLeadPx,
  partBlockRows,
} from './songViewTables';

/** A press on one of these acts on its own and leaves the selection alone. */
const CONTROLS = 'button, select, input, .knob';

/**
 * Set the column's sizes on the lanes as custom properties, from the
 * table: what `console.css` lays the blocks out with. `expanded` is
 * whether ▸ Mixer shows every strip's knobs (windsor#158), which widens
 * the column and moves the timeline right (decision 6).
 */
export function sizeLaneColumn(lanes: HTMLElement, expanded: boolean): void {
  const px: Readonly<Record<string, number>> = {
    '--tab': SONG_VIEW.partTabPx,
    '--tab-gap': SONG_VIEW.partTabGapPx,
    '--row-pad': SONG_VIEW.partRowPadPx,
    '--fold': SONG_VIEW.partFoldPx,
    '--fold-gap': SONG_VIEW.partFoldGapPx,
    '--lead': mixerLeadPx(),
    '--mixer': mixerColumnPx(expanded, EXPANDED_KNOB_COUNT),
    '--frozen': frozenColumnPx(expanded, EXPANDED_KNOB_COUNT),
    '--gap': SONG_VIEW.laneGapPx,
    '--row-gap': SONG_VIEW.rowGapPx,
    '--lane-h': SONG_VIEW.partLanePx,
    '--auto-lane-h': SONG_VIEW.automationLanePx,
    '--auto-add-h': SONG_VIEW.automationAddRowPx,
    '--indent': SONG_VIEW.folderIndentPx,
    '--rail': SONG_VIEW.folderRailPx,
  };
  for (const [name, value] of Object.entries(px)) lanes.style.setProperty(name, `${value}px`);
  lanes.style.setProperty('--mix-knobs', String(EXPANDED_KNOB_COUNT));
}

/** A row group: `frozen`, a block of the frozen column, beside its rows of timeline. */
function laneGroup(frozen: HTMLElement, timeline: readonly HTMLElement[]): HTMLElement {
  frozen.classList.add('lane-frozen');
  const rows = el('div', 'lane-timeline');
  rows.append(...timeline);
  const group = el('div', 'lane-group');
  group.append(frozen, rows);
  return group;
}

/**
 * The head (decision 5): the mixer's header, its arrow and the ruler's
 * corner label, over "loop", beside the ruler and the loop strip.
 */
export function headGroup(
  toggle: MixerToggle,
  [corner, ruler]: [HTMLElement, HTMLElement],
  brace: LoopBraceRow,
): HTMLElement {
  const [loopName, strip] = brace.row;
  const block = el('div', 'lane-head');
  block.append(mixerHeaderCell(toggle, corner), loopName);
  return laneGroup(block, [ruler, strip]);
}

/** HARMONY · chords beside the harmony lane. */
export const harmonyGroup = ([name, lane]: [HTMLElement, HTMLElement]): HTMLElement =>
  laneGroup(name, [lane]);

/**
 * The part's number tab (decisions 2 and 3): its 1-based place, the chip's
 * number, in the colour its regions take, down all `rows` of its block.
 */
function numberTab(part: DocumentPart, index: number, rows: number): HTMLElement {
  const chip = chipLabel(part, index);
  const tab = el('div', 'lane-tab');
  tab.style.setProperty('--pc', chip.tone);
  tab.style.gridRow = `1 / span ${rows}`;
  tab.title = `${chip.meta} · ${chip.name}`;
  tab.appendChild(el('b', '', String(index + 1)));
  return tab;
}

/**
 * The part at `index` in the song's order: its block (the number tab, its
 * row around `strip`, and its open lanes' labels and add row) beside its
 * lane of regions and its curves. Each open lane that plays pushes its
 * value cell onto `readouts`.
 */
export function partGroup(
  view: SongView,
  part: DocumentPart,
  index: number,
  strip: HTMLElement,
  readouts: Readout[],
): HTMLElement {
  const open = view.state.openParts.has(part.slot);
  const rows = partBlockRows(open, part.automation?.length ?? 0);
  const folded = open ? automationRows(view, part, readouts) : [];
  const block = el('div', `lane-col${partSelected(view, part) ? ' selected' : ''}`);
  block.append(
    numberTab(part, index, rows.length),
    partRow(view, part, strip),
    ...folded.map((row) => row.label),
  );
  block.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest(CONTROLS)) return;
    view.select({ kind: 'part', slot: part.slot, region: null });
  });
  return laneGroup(block, [partLane(view, part), ...folded.map((row) => row.timeline)]);
}

/**
 * Set a folder's accent on its row group: the group's colour on the Mixer
 * tab, by its place in the list (`groupAccent`), for its tab, rail and outline.
 */
function tintFolder(view: SongView, group: HTMLElement, id: number): void {
  const index = (view.ctx.model.doc.groups ?? []).findIndex((g) => g.id === id);
  group.style.setProperty('--group-accent', groupAccent(Math.max(0, index)));
}

/**
 * The rows under the harmony lane, in `rows`' order (windsor#615): a
 * group's header beside its outline, and each part's block, inset under its
 * folder when it is a member.
 */
export function bodyGroups(
  view: SongView,
  rows: readonly SongRow[],
  readouts: Readout[],
): HTMLElement[] {
  const { doc } = view.ctx.model;
  const groups: HTMLElement[] = [];
  for (const row of rows) {
    if (row.kind === 'group') {
      const header = groupRow(view, row);
      if (!header) continue;
      const group = laneGroup(header[0], [header[1]]);
      group.classList.add('folder-head');
      tintFolder(view, group, row.id);
      groups.push(group);
      continue;
    }
    const index = doc.parts.findIndex((p) => p.slot === row.slot);
    const part = doc.parts[index];
    if (!part) continue;
    const strip = partMixerCell(view.ctx, part, view.state.mixerExpanded);
    const group = partGroup(view, part, index, strip, readouts);
    if (row.group !== null) {
      group.classList.add('in-folder');
      tintFolder(view, group, row.group);
    }
    groups.push(group);
  }
  return groups;
}
