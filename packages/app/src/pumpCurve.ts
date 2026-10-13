/**
 * The Pump editor's drawing (record `2026-10-13-pump-insert` decision 6):
 * the grid; behind the shape, the key's level across the last cycles in dB,
 * so a kick's body shows where the duck should sit; the drawn shape from
 * the engine's own `pumpLevelAt`, and the gain it plays at the card's depth
 * dashed when that differs; the points and bend handles; and while the key
 * triggers, the playhead.
 */
import { pumpGain, pumpLevelAt } from '@windsor/engine';
import type { PumpPoint } from '@windsor/engine';
import { CARRIER_COLOR, LINE_COLOR } from './consoleColors';
import { handleOf, xOf, yOf } from './pumpCurveModel';
import type { PumpPlot } from './pumpCurveModel';
import { PUMP_GRID, PUMP_PLOT, PUMP_TRACE } from './pumpTables';

export interface PumpPalette {
  readonly accent: string;
  readonly line: string;
  readonly ink: string;
  readonly faint: string;
}

export interface PumpDrawState {
  readonly points: readonly PumpPoint[];
  readonly depth: number;
  readonly plot: PumpPlot;
  readonly palette: PumpPalette;
  /** The key's held trace, linear peak per bin across the cycle; null before any. */
  readonly trace: Float32Array | null;
  /** The playhead, 0 to 1 in a cycle; 1 at rest. */
  readonly phase: number;
}

/** The depth's dashed line: px on, px off. */
const DASH_PX = 3;
const DASH = [DASH_PX, DASH_PX];
const TRACE_ALPHA = 0.28;
const MINOR_ALPHA = 0.35;
const DB_PER_DECADE = 20;
/** Half a px: a 1 px line on a whole px lands sharp. */
const HALF_PX = 0.5;

export function pumpPalette(canvas: HTMLElement): PumpPalette {
  const style = getComputedStyle(canvas);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    accent: read('--kc', CARRIER_COLOR),
    line: LINE_COLOR,
    ink: read('--ink', CARRIER_COLOR),
    faint: read('--ink-faint', LINE_COLOR),
  };
}

/** A canvas context at the device's pixel ratio over the plot's CSS size. */
export function pumpCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(PUMP_PLOT.width * ratio);
  canvas.height = Math.round(PUMP_PLOT.height * ratio);
  const g = canvas.getContext('2d');
  g?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return g;
}

/** A level in dB above the floor as a share of the plot's height, 0 to 1. */
export function traceHeight(level: number): number {
  if (!(level > 0)) return 0;
  const db = DB_PER_DECADE * Math.log10(level);
  return Math.min(1, Math.max(0, 1 - db / PUMP_TRACE.floorDb));
}

function grid(g: CanvasRenderingContext2D, { plot, palette }: PumpDrawState): void {
  g.lineWidth = 1;
  g.strokeStyle = palette.line;
  for (let i = 1; i < PUMP_GRID.steps; i++) {
    g.globalAlpha = i % PUMP_GRID.major === 0 ? 1 : MINOR_ALPHA;
    const x = Math.round(xOf(plot, i / PUMP_GRID.steps)) + HALF_PX;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, plot.height);
    g.stroke();
  }
  g.globalAlpha = MINOR_ALPHA;
  for (const level of PUMP_GRID.levels) {
    const y = Math.round(yOf(plot, level)) + HALF_PX;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(plot.width, y);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function trace(g: CanvasRenderingContext2D, { plot, palette, trace }: PumpDrawState): void {
  if (!trace) return;
  const bins = trace.length;
  g.fillStyle = palette.ink;
  g.globalAlpha = TRACE_ALPHA;
  g.beginPath();
  g.moveTo(xOf(plot, 0), yOf(plot, 0));
  for (let i = 0; i < bins; i++) {
    const y = yOf(plot, traceHeight(trace[i]!));
    g.lineTo(xOf(plot, i / bins), y);
    g.lineTo(xOf(plot, (i + 1) / bins), y);
  }
  g.lineTo(xOf(plot, 1), yOf(plot, 0));
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
}

/** The curve `level` gives, sampled a px at a time across the plot. */
function curve(g: CanvasRenderingContext2D, plot: PumpPlot, level: (at: number) => number): void {
  const span = plot.width - 2 * plot.pad;
  g.beginPath();
  for (let px = 0; px <= span; px++) {
    const at = px / span;
    const x = xOf(plot, at),
      y = yOf(plot, level(at));
    if (px === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

function shape(g: CanvasRenderingContext2D, s: PumpDrawState): void {
  const { plot, palette, points, depth } = s;
  g.lineWidth = 2;
  g.strokeStyle = palette.accent;
  curve(g, plot, (at) => pumpLevelAt(points, at));
  if (depth < 1) {
    g.lineWidth = 1;
    g.setLineDash(DASH);
    g.strokeStyle = palette.ink;
    curve(g, plot, (at) => pumpGain(pumpLevelAt(points, at), depth));
    g.setLineDash([]);
  }
}

function handles(g: CanvasRenderingContext2D, { plot, palette, points }: PumpDrawState): void {
  g.fillStyle = palette.ink;
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i + 1]!.at === points[i]!.at) continue;
    const { x, y } = handleOf(points, i, plot);
    const r = PUMP_PLOT.handleRadius;
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r, y);
    g.lineTo(x, y + r);
    g.lineTo(x - r, y);
    g.closePath();
    g.fill();
  }
  g.fillStyle = palette.accent;
  g.strokeStyle = palette.ink;
  g.lineWidth = 1;
  for (const p of points) {
    g.beginPath();
    g.arc(xOf(plot, p.at), yOf(plot, p.level), PUMP_PLOT.pointRadius, 0, 2 * Math.PI);
    g.fill();
    g.stroke();
  }
}

function playhead(g: CanvasRenderingContext2D, { plot, palette, phase }: PumpDrawState): void {
  if (!(phase < 1)) return;
  const x = Math.round(xOf(plot, phase)) + HALF_PX;
  g.strokeStyle = palette.ink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, plot.height);
  g.stroke();
}

export function drawPump(g: CanvasRenderingContext2D, state: PumpDrawState): void {
  g.clearRect(0, 0, state.plot.width, state.plot.height);
  grid(g, state);
  trace(g, state);
  shape(g, state);
  playhead(g, state);
  handles(g, state);
}
