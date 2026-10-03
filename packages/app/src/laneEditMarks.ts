/**
 * The region-editing marks a Song view lane draws (windsor#550, record
 * `2026-10-03-song-region-editing` decision 4): the amber handle on a
 * block's edge, the seam mark where two blocks meet, and the readout above
 * the lane while dragging. DOM only, styled by `console.css`'s `.hdl`,
 * `.seam` and `.readout` (the approved mockup's); which ones show and what
 * they say is `laneEditModel.ts`. The harmony track draws seams and the
 * readout; the part lanes (windsor#551) add the edge handles.
 */
import { el } from './dom';

/** A handle's state: hidden, faint (its block is selected) or lit (under the pointer or the drag). */
export type HandleLight = '' | 'faint' | 'on';

/** The two `.hdl` handles for a block, start then end, to append inside it. */
export function edgeHandles(start: HandleLight, end: HandleLight): HTMLElement[] {
  const handle = (side: 's' | 'e', light: HandleLight): HTMLElement =>
    el('i', `hdl ${side}${light ? ` ${light}` : ''}`);
  return [handle('s', start), handle('e', end)];
}

/** A `.seam` mark centred on `leftPx` in its lane: a line and a grip, faint or lit. */
export function seamMarkNode(leftPx: number, faint: boolean): HTMLElement {
  const node = el('div', `seam${faint ? ' faint' : ''}`);
  node.style.left = `${leftPx}px`;
  node.appendChild(el('i'));
  node.appendChild(el('b'));
  return node;
}

/** The `.readout` above a lane, centred on `leftPx`. */
export function readoutNode(leftPx: number, text: string): HTMLElement {
  const node = el('div', 'readout', text);
  node.style.left = `${leftPx}px`;
  return node;
}

/** Remove a lane's seam marks and readout, before drawing the current ones. */
export function clearLaneMarks(lane: HTMLElement): void {
  for (const node of lane.querySelectorAll(':scope > .seam, :scope > .readout')) node.remove();
}
