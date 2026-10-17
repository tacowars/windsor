/**
 * Spectre's Curves-page thumbnail (record `2026-10-17-spectre-drawn-cells`
 * decision 11): the three lanes in miniature, the left channel's cells as
 * bars in each lane's colour, the selection tinted behind them. It edits
 * nothing: a press (or Enter) opens the workbench.
 */
import { SPECTRE_CELLS, spectreSelectionMask } from '@windsor/engine';
import type { SpectreSpec } from '@windsor/engine';
import { benchContext, benchPalette } from './spectreBenchDraw';
import { SPECTRE_LANES } from './spectreBenchTables';
import { SPECTRE_LABELS, SPECTRE_THUMB } from './spectreTables';

const BAR_ALPHA = 0.6;
const SELECT_ALPHA = 0.18;

/** The thumbnail over `current()`; `draw` repaints it, `open` runs on a press. */
export function spectreThumb(
  current: () => SpectreSpec,
  open: () => void,
): { element: HTMLElement; draw(): void } {
  const T = SPECTRE_THUMB;
  const canvas = document.createElement('canvas');
  canvas.className = 'spectre-thumb';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'button');
  canvas.setAttribute('aria-label', SPECTRE_LABELS.thumb);
  canvas.title = SPECTRE_LABELS.thumb;
  const g = benchContext(canvas, T.width, T.height);
  canvas.addEventListener('click', open);
  canvas.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    open();
  });
  const draw = (): void => {
    if (!g || !canvas.isConnected) return;
    const palette = benchPalette(canvas);
    const spec = current();
    const count = SPECTRE_LANES.length;
    const laneH = (T.height - (count - 1) * T.gapPx) / count;
    const w = T.width / SPECTRE_CELLS;
    const mask = spectreSelectionMask(spec.selection);
    g.clearRect(0, 0, T.width, T.height);
    SPECTRE_LANES.forEach(({ curve }, lane) => {
      const top = lane * (laneH + T.gapPx);
      g.fillStyle = palette.inset;
      g.fillRect(0, top, T.width, laneH);
      g.globalAlpha = SELECT_ALPHA;
      g.fillStyle = palette.select;
      for (let i = 0; i < SPECTRE_CELLS; i++) if (mask[i]) g.fillRect(i * w, top, w, laneH);
      g.globalAlpha = BAR_ALPHA;
      g.fillStyle = palette.lanes[curve];
      const cells = spec.curves[curve].left;
      for (let i = 0; i < SPECTRE_CELLS; i++) {
        const h = cells[i]! * laneH;
        g.fillRect(i * w, top + laneH - h, w, h);
      }
      g.globalAlpha = 1;
    });
  };
  const element = document.createElement('div');
  element.className = 'spectre-plot-wrap';
  element.append(canvas);
  // The canvas reads the rack's colours once it is in the page.
  requestAnimationFrame(draw);
  return { element, draw };
}
