/**
 * Spectre's workbench drawing (record `2026-10-17-spectre-drawn-cells`
 * decision 10): each lane's cells as bars from its foot, over the live
 * spectrum (the input filled faintly, the output as a line); the selection
 * in force tinted in the carrier accent across all three lanes; the curve as
 * the bands hear it as a line over the bars; a shape's preview as a ghost;
 * the delay lane's grid; the hovered band; and the ruler, in Hz and the C of
 * each octave, with the song's key marked when asked. Geometry is
 * `spectreBenchModel.ts`'s.
 */
import { SPECTRE_CELLS, spectreAxisAt, spectreChannelCells } from '@windsor/engine';
import type { SpectreCurve, SpectreSpec } from '@windsor/engine';
import { CARRIER_COLOR, LINE_COLOR } from './consoleColors';
import { cellWidth, spectrumLevel, xOfAxis, xOfCell, yOfValue } from './spectreBenchModel';
import type { SpectreBenchLayout, SpectreLaneBox } from './spectreBenchModel';
import { midiHz } from './spectreGenerators';
import {
  SPECTRE_BENCH,
  SPECTRE_DRAW,
  SPECTRE_LANE_COLOR,
  SPECTRE_LANE_LABELS,
  SPECTRE_LANE_SCALE,
  SPECTRE_RULER_HZ,
} from './spectreBenchTables';

export interface SpectreBenchPalette {
  readonly ink: string;
  readonly dim: string;
  readonly faint: string;
  readonly line: string;
  readonly inset: string;
  readonly select: string;
  readonly lanes: Readonly<Record<SpectreCurve, string>>;
}

/** What one frame draws. */
export interface SpectreBenchFrame {
  readonly spec: SpectreSpec;
  readonly layout: SpectreBenchLayout;
  readonly channel: 0 | 1;
  readonly palette: SpectreBenchPalette;
  /** The selection in force, a flag a cell. */
  readonly active: readonly boolean[];
  /** Each lane as the bands hear it. */
  readonly heard: Readonly<Record<SpectreCurve, readonly number[]>>;
  /** A shape waiting for Apply: its lane and cells. */
  readonly preview: { readonly curve: SpectreCurve; readonly cells: readonly number[] } | null;
  /** The scope's last report for the edited channel, and the resolution it was taken at. */
  readonly spectrum: { readonly input: Float32Array; readonly output: Float32Array } | null;
  readonly bands: number;
  /** The grid's step on the delay lane, a share of full scale; 0 off. */
  readonly grid: number;
  /** The hovered cell and the brush's span over it, or null. */
  readonly hover: { readonly cell: number; readonly from: number; readonly to: number } | null;
  /** The lane the Shape row writes to. */
  readonly focus: SpectreCurve;
  /** Cells of the song's key to mark on the ruler, or null. */
  readonly keyCells: readonly number[] | null;
}

const {
  barAlpha: BAR_ALPHA,
  selectAlpha: SELECT_ALPHA,
  spectrumAlpha: SPECTRUM_ALPHA,
  gridAlpha: GRID_ALPHA,
  ghostDash: GHOST_DASH,
  gapFromPx: GAP_FROM_PX,
  labelInset: LABEL_INSET,
  labelLine: LABEL_LINE,
  octavesOfC: OCTAVES_OF_C,
  tickPx: TICK_PX,
  keyDotPx: KEY_DOT_PX,
  maxGridLines: MAX_GRID_LINES,
} = SPECTRE_DRAW;
/** Half a pixel: a 1 px line drawn on a pixel's centre. */
const HALF = 0.5;
const C_OF_OCTAVE = (octave: number): number => SPECTRE_DRAW.semitones * (octave + 1);

/** The palette from the canvas's custom properties, with the console's fallbacks. */
export function benchPalette(canvas: HTMLElement): SpectreBenchPalette {
  const style = getComputedStyle(canvas);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    ink: read('--ink', CARRIER_COLOR),
    dim: read('--ink-dim', LINE_COLOR),
    faint: read('--ink-faint', LINE_COLOR),
    line: read('--line', LINE_COLOR),
    inset: read('--inset', '#000'),
    select: read('--carrier', CARRIER_COLOR),
    lanes: {
      gain: read(SPECTRE_LANE_COLOR.gain, CARRIER_COLOR),
      delay: read(SPECTRE_LANE_COLOR.delay, CARRIER_COLOR),
      feedback: read(SPECTRE_LANE_COLOR.feedback, CARRIER_COLOR),
    },
  };
}

function laneFrame(g: CanvasRenderingContext2D, f: SpectreBenchFrame, lane: SpectreLaneBox): void {
  const { layout, palette } = f;
  g.fillStyle = palette.inset;
  g.fillRect(layout.left, lane.top, layout.right - layout.left, lane.height);
  g.strokeStyle = lane.curve === f.focus ? palette.lanes[lane.curve] : palette.line;
  g.lineWidth = 1;
  g.strokeRect(
    layout.left + HALF,
    lane.top + HALF,
    layout.right - layout.left - 1,
    lane.height - 1,
  );
  g.font = SPECTRE_BENCH.font;
  g.textAlign = 'right';
  g.textBaseline = 'top';
  g.fillStyle = palette.lanes[lane.curve];
  g.fillText(SPECTRE_LANE_LABELS[lane.curve].toUpperCase(), layout.left - LABEL_INSET, lane.top);
  g.font = SPECTRE_BENCH.smallFont;
  g.fillStyle = palette.faint;
  const [top, bottom] = SPECTRE_LANE_SCALE[lane.curve];
  g.fillText(top, layout.left - LABEL_INSET, lane.top + LABEL_LINE + 2);
  g.textBaseline = 'bottom';
  g.fillText(bottom, layout.left - LABEL_INSET, lane.top + lane.height);
}

function spectrum(g: CanvasRenderingContext2D, f: SpectreBenchFrame, lane: SpectreLaneBox): void {
  if (!f.spectrum) return;
  const { layout, palette, channel } = f;
  const w = cellWidth(layout);
  const base = channel * SPECTRE_CELLS;
  g.globalAlpha = SPECTRUM_ALPHA;
  g.fillStyle = palette.dim;
  for (let i = 0; i < SPECTRE_CELLS; i++) {
    const level = spectrumLevel(f.spectrum.input[base + i]!, f.bands);
    if (level <= 0) continue;
    const y = yOfValue(lane, level);
    g.fillRect(xOfCell(layout, i), y, w, lane.top + lane.height - y);
  }
  g.globalAlpha = 1;
  g.strokeStyle = palette.ink;
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i < SPECTRE_CELLS; i++) {
    const y = yOfValue(lane, spectrumLevel(f.spectrum.output[base + i]!, f.bands));
    const x = xOfCell(layout, i) + w / 2;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.globalAlpha = SPECTRUM_ALPHA * 2;
  g.stroke();
  g.globalAlpha = 1;
}

function selection(g: CanvasRenderingContext2D, f: SpectreBenchFrame, lane: SpectreLaneBox): void {
  const { layout, palette } = f;
  const w = cellWidth(layout);
  g.globalAlpha = SELECT_ALPHA;
  g.fillStyle = palette.select;
  for (let i = 0; i < SPECTRE_CELLS; i++) {
    if (f.active[i]) g.fillRect(xOfCell(layout, i), lane.top, w, lane.height);
  }
  g.globalAlpha = 1;
}

function bars(g: CanvasRenderingContext2D, f: SpectreBenchFrame, lane: SpectreLaneBox): void {
  const { layout, palette } = f;
  const cells = spectreChannelCells(f.spec.curves[lane.curve], f.channel);
  const w = cellWidth(layout);
  const gap = w >= GAP_FROM_PX ? 1 : 0;
  const foot = lane.top + lane.height;
  const color = palette.lanes[lane.curve];
  g.fillStyle = color;
  g.globalAlpha = BAR_ALPHA;
  for (let i = 0; i < SPECTRE_CELLS; i++) {
    const y = yOfValue(lane, cells[i]!);
    g.fillRect(xOfCell(layout, i), y, w - gap, foot - y);
  }
  g.globalAlpha = 1;
  for (let i = 0; i < SPECTRE_CELLS; i++) {
    const y = yOfValue(lane, cells[i]!);
    g.fillRect(xOfCell(layout, i), Math.floor(y), w - gap, 1);
  }
}

function heard(g: CanvasRenderingContext2D, f: SpectreBenchFrame, lane: SpectreLaneBox): void {
  const { layout, palette } = f;
  const w = cellWidth(layout);
  g.strokeStyle = palette.ink;
  g.lineWidth = 1;
  g.beginPath();
  f.heard[lane.curve].forEach((v, i) => {
    const x = xOfCell(layout, i) + w / 2,
      y = yOfValue(lane, v);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
}

function ghost(g: CanvasRenderingContext2D, f: SpectreBenchFrame, lane: SpectreLaneBox): void {
  if (f.preview?.curve !== lane.curve) return;
  const { layout, palette } = f;
  const w = cellWidth(layout);
  g.strokeStyle = palette.select;
  g.setLineDash([...GHOST_DASH]);
  g.beginPath();
  f.preview.cells.forEach((v, i) => {
    const y = yOfValue(lane, v);
    g.moveTo(xOfCell(layout, i), y);
    g.lineTo(xOfCell(layout, i) + w, y);
  });
  g.stroke();
  g.setLineDash([]);
}

function grid(g: CanvasRenderingContext2D, f: SpectreBenchFrame, lane: SpectreLaneBox): void {
  if (lane.curve !== 'delay' || f.grid <= 0) return;
  const { layout, palette } = f;
  const every = Math.max(1, Math.ceil(1 / f.grid / MAX_GRID_LINES));
  g.strokeStyle = palette.line;
  g.globalAlpha = GRID_ALPHA;
  g.beginPath();
  for (let k = every; k * f.grid < 1; k += every) {
    const y = Math.round(yOfValue(lane, k * f.grid)) + HALF;
    g.moveTo(layout.left, y);
    g.lineTo(layout.right, y);
  }
  g.stroke();
  g.globalAlpha = 1;
}

function hover(g: CanvasRenderingContext2D, f: SpectreBenchFrame): void {
  if (!f.hover) return;
  const { layout, palette } = f;
  const w = cellWidth(layout);
  g.strokeStyle = palette.faint;
  g.lineWidth = 1;
  for (const lane of layout.lanes) {
    const x0 = xOfCell(layout, f.hover.from),
      x1 = xOfCell(layout, f.hover.to) + w;
    g.strokeRect(
      Math.round(x0) + HALF,
      lane.top + HALF,
      Math.max(1, Math.round(x1 - x0) - 1),
      lane.height - 1,
    );
  }
}

function ruler(g: CanvasRenderingContext2D, f: SpectreBenchFrame): void {
  const { layout, palette } = f;
  const y = layout.ruler + 2;
  g.font = SPECTRE_BENCH.smallFont;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.strokeStyle = palette.line;
  g.fillStyle = palette.faint;
  g.beginPath();
  for (const [hz, label] of SPECTRE_RULER_HZ) {
    const x = Math.round(xOfAxis(layout, spectreAxisAt(hz))) + HALF;
    g.moveTo(x, y);
    g.lineTo(x, y + TICK_PX);
    g.fillText(label, x, y + TICK_PX + 1);
  }
  g.stroke();
  g.fillStyle = palette.dim;
  g.textBaseline = 'bottom';
  for (const octave of OCTAVES_OF_C) {
    const at = spectreAxisAt(midiHz(C_OF_OCTAVE(octave)));
    if (at <= 0 || at >= 1) continue;
    g.fillText(`C${octave}`, xOfAxis(layout, at), layout.height);
  }
  if (!f.keyCells) return;
  g.fillStyle = palette.select;
  const w = cellWidth(layout);
  for (const cell of f.keyCells) {
    if (cell < 0) continue;
    g.fillRect(
      xOfCell(layout, cell) + w * HALF - KEY_DOT_PX * HALF,
      y - KEY_DOT_PX,
      KEY_DOT_PX,
      KEY_DOT_PX,
    );
  }
}

/** One whole frame of the workbench. */
export function drawBench(g: CanvasRenderingContext2D, f: SpectreBenchFrame): void {
  g.clearRect(0, 0, f.layout.width, f.layout.height);
  for (const lane of f.layout.lanes) {
    laneFrame(g, f, lane);
    spectrum(g, f, lane);
    selection(g, f, lane);
    grid(g, f, lane);
    bars(g, f, lane);
    heard(g, f, lane);
    ghost(g, f, lane);
  }
  hover(g, f);
  ruler(g, f);
}

/** A canvas context at the device's pixel ratio over `width` × `height` CSS px, which it sets. */
export function benchContext(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const g = canvas.getContext('2d');
  g?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return g;
}
