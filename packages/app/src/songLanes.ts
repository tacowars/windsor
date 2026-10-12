/**
 * The part lanes (#709 decisions 1 and 3): one lane per part by slot, and
 * the part's row in the frozen column. A lane's blocks and editing marks
 * are `partLaneBlocks.ts`, its pointer `partLaneGestures.ts` (windsor#551:
 * edges that show themselves, seams that roll, drag-to-draw and a readout)
 * over the pure `partLaneModel.ts` and `regionModel.ts`.
 *
 * The part's row in the frozen column holds its fold, which folds its
 * automation lanes out beneath it (windsor#348; `songAutomationLane.ts`
 * draws them), with a folded part's lane count beside the arrow, and its
 * mixer strip (windsor#534; `songLaneColumn.ts` puts the row in the part's
 * block).
 *
 * `pointerDrag` moved to `pointerDrag.ts` (windsor#551); it is re-exported
 * here for the harmony lane and the loop brace, which import it from here.
 */
import type { DocumentPart } from '@windsor/engine';
import { partColor } from './consoleColors';
import { disclosureArrow, turnDisclosure } from './disclosureArrow';
import { el } from './dom';
import { paintLaneMarks, paintRegions } from './partLaneBlocks';
import { wirePartLane } from './partLaneGestures';
import { laneCountLabel } from './songAutomationModel';
import type { SongView } from './songTab';
import { outlinedSlot } from './songViewTables';

export type { DragHandlers } from './pointerDrag';
export { pointerDrag } from './pointerDrag';

/**
 * The part's fold (windsor#348 decision 1): the arrow points right folded
 * and down with its automation lanes shown beneath it. The button is the
 * whole fold cell (windsor#768 decision 2), a folded part's lane count
 * inside it beside the arrow, so a press anywhere in the cell folds; it
 * never selects the part. Which parts are open is view state, kept for the
 * session; the focus stays on the button across the repaint.
 */
function foldButton(view: SongView, part: DocumentPart): HTMLButtonElement {
  const open = view.state.openParts.has(part.slot);
  const button = el('button', 'tri disclosure') as HTMLButtonElement;
  button.appendChild(disclosureArrow('fold'));
  const lanes = part.automation?.length ?? 0;
  // The count alone fits beside the arrow in the 50 px cell, as the mockup draws it; the title names it.
  if (lanes > 0 && !open) {
    button.appendChild(el('span', 'auto-badge', String(lanes)));
    button.title = laneCountLabel(lanes);
  }
  button.type = 'button';
  button.dataset['focus'] = `fold:${part.slot}`;
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} automation for ${part.name}`);
  button.onclick = (e): void => {
    e.stopPropagation();
    const grid = button.closest('.lanes');
    if (open) view.state.openParts.delete(part.slot);
    else view.state.openParts.add(part.slot);
    view.paintLanes();
    const next = grid?.querySelector<HTMLElement>(`[data-focus="fold:${part.slot}"]`) ?? null;
    next?.focus();
    turnDisclosure(next);
  };
  return button;
}

/**
 * Whether `part` is the shared part selection (windsor#534 decision 8), the
 * one the strip highlights: its block is outlined and its lane bordered
 * whether or not the detail pane is open.
 */
export const partSelected = (view: SongView, part: DocumentPart): boolean =>
  outlinedSlot(
    view.ctx.parts.selected,
    view.ctx.model.doc.parts.map((p) => p.slot),
  ) === part.slot;

/**
 * The part's row in the frozen column (windsor#534 decision 2): its fold,
 * then `strip`, its mixer strip. The strip shows the part's name and kind,
 * so the row repeats neither.
 */
export function partRow(view: SongView, part: DocumentPart, strip: HTMLElement): HTMLElement {
  const row = el('div', 'lane-part');
  row.title = part.name;
  const fold = el('div', 'lane-fold');
  fold.appendChild(foldButton(view, part));
  row.append(fold, strip);
  return row;
}

/** The lane of regions for `part`, with the selected region's faint handles and seam marks. */
export function partLane(view: SongView, part: DocumentPart): HTMLElement {
  const lane = el('div', `lane${partSelected(view, part) ? ' selected' : ''}`);
  // The part's colour (windsor#642): the selected lane's border, and every region block's (`partLaneBlocks.ts`).
  lane.style.setProperty('--pc', partColor(part.colour).hex);
  // Which part the lane is, for a body drag from another lane to find it by its height (`partLaneTransfer.ts`).
  lane.dataset['partSlot'] = String(part.slot);
  lane.title =
    'drag an edge to resize, a seam to move both regions, the body to move it, onto another part of its kind too (cmd/ctrl-drag copies) · ' +
    'drag an empty stretch to draw, click it for a bar · shift snaps to the step · alt-click splits · ' +
    'cmd/ctrl+C, X, V copy, cut and paste at the playhead · cmd/ctrl+D duplicates · delete removes';
  paintRegions(view, lane, part, part.regions);
  paintLaneMarks(view, lane, part.slot, part.regions, { active: null, readout: null });
  wirePartLane(view, lane, part.slot);
  return lane;
}
