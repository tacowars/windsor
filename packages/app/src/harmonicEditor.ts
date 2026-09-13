/**
 * The operator bay's User-wave editor (#511): drag across the bars to draw
 * harmonic levels, pick 16 / 32 / 64 bars, see the resulting cycle. Every
 * stroke step writes `ops[i].userPartials` in the working patch and pushes it,
 * so the document and the live part hear the drawing as it happens.
 */
import { OP_NAMES, WAVE } from '../../../packages/client/src/audio/index-for-editor';
import { el, seg } from './dom';
import {
  HARMONIC_COUNTS,
  countFor,
  paintStroke,
  pointToBar,
  resizePartials,
  seedPartials,
  waveCycle,
} from './harmonicModel';
import type { BarPoint, HarmonicCount } from './harmonicModel';
import { partsState, pushPatch } from './patchState';

const PREVIEW_POINTS = 96;
const BAR_GAP_PX = 1;

/** Give a User operator something to draw on; other waves keep whatever they carry. */
export function ensureUserPartials(i: number): void {
  const op = partsState.patch.ops[i];
  if (op && op.wave === WAVE.USER && !op.userPartials) op.userPartials = seedPartials();
}

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  g?.clearRect(0, 0, w, h);
  return g;
}

function drawBars(canvas: HTMLCanvasElement, partials: readonly number[], color: string): void {
  const g = fitCanvas(canvas);
  if (!g) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const count = countFor(partials);
  const barW = w / count;
  g.fillStyle = color;
  for (let b = 0; b < count; b++) {
    const v = Math.min(1, Math.max(0, partials[b] ?? 0));
    if (v <= 0) continue;
    g.fillRect(b * barW, h - v * h, Math.max(1, barW - BAR_GAP_PX), v * h);
  }
}

function drawCycle(canvas: HTMLCanvasElement, partials: readonly number[], color: string): void {
  const g = fitCanvas(canvas);
  if (!g) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const cycle = waveCycle(partials, PREVIEW_POINTS);
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  g.beginPath();
  cycle.forEach((v, i) => {
    const x = (i / (PREVIEW_POINTS - 1)) * w;
    const y = h / 2 - (v * (h - 4)) / 2;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
}

function attachStroke(canvas: HTMLCanvasElement, i: number, redraw: () => void): void {
  let last: BarPoint | null = null;
  let drawing = false;
  const step = (e: PointerEvent): void => {
    const op = partsState.patch.ops[i];
    if (!op) return;
    ensureUserPartials(i);
    const partials = op.userPartials ?? seedPartials();
    const rect = canvas.getBoundingClientRect();
    const point = pointToBar(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      { width: rect.width, height: rect.height },
      countFor(partials),
    );
    paintStroke(partials, last, point);
    op.userPartials = partials;
    last = point;
    pushPatch();
    redraw();
  };
  const stop = (e: PointerEvent): void => {
    drawing = false;
    last = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    step(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    // Same guard as the knobs: a release lost with capture must not leave the pen down.
    if ((e.buttons & 1) === 0) return stop(e);
    step(e);
  });
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('lostpointercapture', stop);
}

/** Build the editor for operator `i`; `sync` shows it only while the wave is User. */
export function harmonicEditor(i: number, color: string): { root: HTMLElement; sync: () => void } {
  const root = el('div', 'harm');
  const bars = el('canvas', 'harm-bars') as HTMLCanvasElement;
  bars.setAttribute('aria-label', `Operator ${OP_NAMES[i]} harmonic levels: drag to draw`);
  const preview = el('canvas', 'harm-preview') as HTMLCanvasElement;
  preview.setAttribute('aria-label', `Operator ${OP_NAMES[i]} User wave cycle`);
  const partials = (): readonly number[] => partsState.patch.ops[i]?.userPartials ?? seedPartials();
  const redraw = (): void => {
    drawBars(bars, partials(), color);
    drawCycle(preview, partials(), color);
  };
  const counts = seg(
    HARMONIC_COUNTS.map((c) => ({ value: String(c), label: String(c) })),
    () => String(countFor(partsState.patch.ops[i]?.userPartials ?? null)),
    (value) => {
      const op = partsState.patch.ops[i];
      if (!op) return;
      op.userPartials = resizePartials(op.userPartials, Number(value) as HarmonicCount);
      pushPatch();
      redraw();
    },
    color,
  );
  counts.classList.add('harm-counts');
  const foot = el('div', 'harm-foot');
  foot.append(counts, preview);
  root.append(el('span', 'field-label', 'Harmonics'), bars, foot);
  attachStroke(bars, i, redraw);
  const sync = (): void => {
    const user = partsState.patch.ops[i]?.wave === WAVE.USER;
    root.style.display = user ? '' : 'none';
    if (user) requestAnimationFrame(redraw);
  };
  sync();
  return { root, sync };
}
