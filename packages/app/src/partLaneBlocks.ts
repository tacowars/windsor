/**
 * What a part lane draws (#709 decisions 1 and 3; windsor#551): one `.reg`
 * block per region — in the part's colour, the `--pc` its lane carries
 * (windsor#642, record `2026-10-07-part-colours` decision 7), the kind and
 * its summary in small caps, ⟲ on a region the pattern restarts in
 * and ∞ on the one whole-song region, faint ticks at the pattern's cycle —
 * and over them the editing marks: each block's two edge handles, the seam
 * marks where two regions touch and the readout while dragging
 * (`laneEditMarks.ts`, lit as `partLaneModel.ts` says). A region a drag is
 * drawing is `.drawing`, with a dashed border.
 *
 * Each region carries its own pattern (windsor#75): a block's summary and
 * cycle ticks are that region's (`regionPattern`).
 */
import type { MusicPart, PartRegion, Region } from '@windsor/engine';
import { regionPattern } from '@windsor/engine';
import { el } from './dom';
import type { LaneHit } from './laneEditModel';
import { seamMarks } from './laneEditModel';
import { clearLaneMarks, edgeHandles, readoutNode, seamMarkNode } from './laneEditMarks';
import type { LaneScale, Readout } from './partLaneModel';
import { handleLights, partLaneGeometry } from './partLaneModel';
import { regionMark } from './regionModel';
import type { SongView } from './songTab';
import {
  CYCLE_TICKS,
  REGION_SUMMARY,
  blockBox,
  forKind,
  isNarrowBlock,
  partNames,
  tickToPx,
} from './songViewTables';

/** The lane's scale at the view's zoom and the song's bar. */
export const laneScaleOf = (view: SongView): LaneScale => ({
  pxPerBar: view.state.pxPerBar,
  bar: view.ticksPerBar(),
});

/** The region of the part on `slot` the Song view has selected, if any. */
export function selectedRegion(view: SongView, slot: number): number | null {
  const selected = view.state.selection;
  return selected?.kind === 'part' && selected.slot === slot ? selected.region : null;
}

/** One `.reg` block for region `index` of `part`, labelled with that region's own pattern. */
function regionBlock(view: SongView, part: MusicPart, index: number, region: Region): HTMLElement {
  const pattern = regionPattern(part, index);
  const cycle = forKind(CYCLE_TICKS, pattern);
  const node = el('div', `reg${cycle ? ' cyc' : ''}`);
  const { pxPerBar, bar } = laneScaleOf(view);
  const box = blockBox(region.start, region.duration, pxPerBar, bar);
  node.style.left = `${box.leftPx}px`;
  node.style.width = `${box.widthPx}px`;
  node.classList.toggle('narrow', isNarrowBlock(box.widthPx));
  if (cycle) node.style.setProperty('--cyc', `${tickToPx(cycle, pxPerBar, bar)}px`);
  const mark = regionMark(part.regions, view.songTicks());
  const glyph = el('span', 'gl', mark);
  glyph.title = mark === '∞' ? 'whole song: free-running' : 'restarts on entry';
  node.appendChild(glyph);
  const { doc } = view.ctx.model;
  const summary = forKind(REGION_SUMMARY, pattern, doc.transport.meter, partNames(doc));
  node.appendChild(el('span', 'lb', summary));
  node.classList.toggle('selected', selectedRegion(view, part.slot) === index);
  return node;
}

/**
 * Redraw the lane's blocks from `regions` — the drag preview and the paint
 * after a commit share it — the region at `drawing` dashed, as a draw
 * previews it. The marks go with the blocks; `paintLaneMarks` draws them.
 */
export function paintRegions(
  view: SongView,
  lane: HTMLElement,
  part: MusicPart,
  regions: readonly PartRegion[],
  drawing: number | null = null,
): void {
  lane.replaceChildren(
    ...regions.map((region, index) => {
      const node = regionBlock(view, { ...part, regions }, index, region);
      node.classList.toggle('drawing', index === drawing);
      return node;
    }),
  );
}

/** What the marks show: the hit under the pointer or the drag (`active`), and the drag's readout. */
export interface LaneMarks {
  readonly active: LaneHit | null;
  readonly readout: Readout | null;
}

/**
 * The editing marks over the lane's blocks, drawn from `regions` (the
 * document's, or a drag's draft): each block's two handles, lit on the edge
 * `active` names and faint on the selected block; the seam marks, lit on
 * the active seam and faint beside the selected block; and the readout.
 */
export function paintLaneMarks(
  view: SongView,
  lane: HTMLElement,
  slot: number,
  regions: readonly Region[],
  marks: LaneMarks,
): void {
  const scale = laneScaleOf(view);
  const geometry = partLaneGeometry(regions, scale);
  const selected = selectedRegion(view, slot);
  lane.querySelectorAll<HTMLElement>(':scope > .reg').forEach((node, index) => {
    for (const handle of node.querySelectorAll(':scope > .hdl')) handle.remove();
    node.append(...edgeHandles(...handleLights(index, marks.active, selected)));
  });
  clearLaneMarks(lane);
  const active = marks.active?.kind === 'seam' ? marks.active.index : null;
  for (const mark of seamMarks(geometry.seams, selected, active)) {
    const seam = geometry.seams.find((s) => s.index === mark.index);
    if (seam) lane.appendChild(seamMarkNode(seam.px, mark.faint));
  }
  const { readout } = marks;
  if (readout) {
    lane.appendChild(readoutNode(tickToPx(readout.tick, scale.pxPerBar, scale.bar), readout.text));
  }
}
