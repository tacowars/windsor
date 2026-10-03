/**
 * The Figure device (windsor#490, epic windsor#483; record
 * `2026-10-03-figure-sequencer`, look
 * `docs/research/2026-10-03-figure-sequencer/figure.html`, approved in
 * windsor#489): the body the Song pane's frame (`sequencerDevice.ts`) puts
 * beside the shared rail, at the device's one height, under two page tabs
 * as the Euclid device has them.
 *
 * - **Cells**: the Play columns (`figureControls.ts`) and the strip
 *   (`figureGrid.ts`). No section labels: the tabs take their 20 px, and
 *   the summary at the tabs' right names the chord, the stage, the drift
 *   and the source in play.
 * - **Process** (`figureProcessPage.ts`): Schedule, Drift and Source.
 *
 * Both pages share one grid cell, the hidden one kept in the layout but not
 * drawn, so the device keeps the Cells page's width on either. The shown
 * page is the session's, per part. One playhead loop (the strip's) lights
 * the cell, repaints what moved and runs this card's summary and the
 * Process page's paint.
 */
import { chordName, eventChord, scaleOffsets } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { figureControls } from './figureControls';
import { type FigureView, figureGrid } from './figureGrid';
import { driftRotation, figureSummary } from './figureProcessModel';
import { figureProcessPage } from './figureProcessPage';
import type { DeviceBody } from './sequencerDevice';
import { specOf } from './stepStrip';

type FigurePage = 'cells' | 'process';

const PAGES: readonly { page: FigurePage; label: string }[] = [
  { page: 'cells', label: 'Cells' },
  { page: 'process', label: 'Process' },
];

/** The page each part shows, by slot: the session's, never the song's. */
const shownPages = new Map<number, FigurePage>();

/** The tab row over `pages`, the part's page selected, and the summary at its end. */
function tabs(
  slot: number,
  pages: Readonly<Record<FigurePage, HTMLElement>>,
): { row: HTMLElement; note: HTMLElement } {
  const row = el('div', 'figure-tabs');
  row.setAttribute('role', 'tablist');
  row.setAttribute('aria-label', 'Figure pages');
  const show = (page: FigurePage): void => {
    shownPages.set(slot, page);
    row.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.page === page));
    });
    for (const { page: other } of PAGES) pages[other].hidden = other !== page;
  };
  for (const { page, label } of PAGES) {
    const tab = el('button', '', label) as HTMLButtonElement;
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.dataset.page = page;
    tab.onclick = (): void => show(page);
    row.appendChild(tab);
    pages[page].setAttribute('role', 'tabpanel');
    pages[page].setAttribute('aria-label', label);
  }
  const note = el('span', 'figure-tab-note');
  row.appendChild(note);
  show(shownPages.get(slot) ?? 'cells');
  return { row, note };
}

/** The tab bar's summary for what the strip shows now. */
function summaryOf(
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
  view: FigureView,
): string {
  const own = specOf(ctx, slot, 'figure', region);
  const line = view.line;
  const key = ctx.model.doc.harmony;
  const chord = view.chord
    ? chordName(key.root, eventChord(scaleOffsets(key.scale), view.chord.event))
    : null;
  return figureSummary({
    cells: line?.cells.length ?? 0,
    chord,
    stages: line?.schedule,
    stage: view.stage,
    drift: line?.drift,
    rotation: driftRotation(line?.drift, view.bar ?? 0),
    source: own?.source,
    leader: view.leader,
  });
}

/** The device body for a `figure` part's region `region`: the tabs and the Cells and Process pages. */
export function figureCard(ctx: AppCtx, slot: number, region?: number): DeviceBody {
  const cells = el('div', 'figure-page figure-cells');
  let paintProcess: (stage: number) => void = () => undefined;
  let note: HTMLElement | null = null;
  const body = el('div', 'seq-device-body figure-device');
  const strip = figureGrid(ctx, slot, region, {
    onFrame: (view) => {
      const text = summaryOf(ctx, slot, region, view);
      if (note && note.textContent !== text) note.textContent = text;
      paintProcess(view.borrowed ? -1 : view.stage);
    },
    device: () => body,
  });
  const repaint = (): void => strip.repaint();
  cells.append(figureControls({ ctx, slot, region, repaint }), strip.section);
  const process = figureProcessPage(ctx, slot, region, repaint);
  paintProcess = process.paint;
  const row = tabs(slot, { cells, process: process.root });
  note = row.note;
  note.textContent = summaryOf(ctx, slot, region, strip.view);
  const pages = el('div', 'figure-pages');
  pages.append(cells, process.root);
  body.append(row.row, pages);
  return { body, fit: 'fixed' };
}
