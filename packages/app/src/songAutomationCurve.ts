/**
 * A lane's curve as SVG geometry (windsor#348; record
 * `2026-10-01-song-automation-lanes` decisions 5 and 13, the issue's
 * decision 6): the line, the fill below it and the dots, over the lane's
 * width at the view's zoom.
 *
 * - Ticks map to px through the Song view's `tickToPx`, so a zoom redraws
 *   the curve with the regions.
 * - Heights are display space (the engine's `toDisplay`): the level lane in
 *   dB, the cutoff in octaves, so a straight segment is an even fade.
 * - A bent segment is sampled every `sampleEveryPx` along the engine's own
 *   `bendCurve`, the evaluator's curve; a straight one is one line, a step
 *   (two points on a tick) a vertical one.
 * - Before the first point the line holds its value from the lane's left
 *   edge, after the last it holds to the right edge (decision 4).
 * - With more points than px, the interior points draw no dot; the line
 *   still runs through them.
 */
import type { AutomationPoint, AutomationTargetRow } from '@windsor/engine';
import { bendCurve, toDisplay } from '@windsor/engine';
import { AUTOMATION_DRAWING, type AutomationDrawing } from './songAutomationTables';
import { tickToPx } from './songViewTables';

/** Where a lane draws: its size in px and the view's zoom. */
export interface CurveFrame {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pxPerBar: number;
  /** The song's bar in ticks, which `pxPerBar` spans (windsor#430); 4/4's when absent. */
  readonly ticksPerBar?: number;
  readonly drawing?: AutomationDrawing;
}

export interface CurveDot {
  readonly x: number;
  readonly y: number;
}

/** A lane's SVG: the line's path, the closed fill below it, and the dots. */
export interface CurveShape {
  readonly line: string;
  readonly area: string;
  readonly dots: readonly CurveDot[];
}

/** The px from a lane's top where a display height (0..1) draws, inside `padPx` at both ends. */
export const laneY = (
  display: number,
  heightPx: number,
  drawing: AutomationDrawing = AUTOMATION_DRAWING,
): number => drawing.padPx + (1 - display) * (heightPx - 2 * drawing.padPx);

/** The curve of `points` on `row`'s scale, inside `frame`. */
export function curveShape(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  frame: CurveFrame,
): CurveShape {
  const { widthPx: w, heightPx: h, pxPerBar, ticksPerBar, drawing = AUTOMATION_DRAWING } = frame;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return { line: '', area: '', dots: [] };
  const yAt = (display: number): number => laneY(display, h, drawing);
  const xOf = (p: AutomationPoint): number => tickToPx(p.tick, pxPerBar, ticksPerBar);
  const yOf = (p: AutomationPoint): number => yAt(toDisplay(row, p.value));
  const n = (v: number): string => v.toFixed(drawing.coordDecimals);
  const to = (x: number, y: number): string => `L${n(x)} ${n(y)}`;
  const parts = [`M0 ${n(yOf(first))}`, to(xOf(first), yOf(first))];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const ya = toDisplay(row, a.value);
    const yb = toDisplay(row, b.value);
    const xa = xOf(a);
    const xb = xOf(b);
    if (b.tick === a.tick || a.bend === 0 || ya === yb) {
      parts.push(to(xb, yAt(yb)));
      continue;
    }
    const steps = Math.max(2, Math.ceil((xb - xa) / drawing.sampleEveryPx));
    for (let k = 1; k <= steps; k++) {
      const u = k / steps;
      parts.push(to(xa + (xb - xa) * u, yAt(ya + (yb - ya) * bendCurve(u, a.bend, yb - ya))));
    }
  }
  parts.push(to(w, yOf(last)));
  const line = parts.join(' ');
  const area = `${line} L${n(w)} ${n(h)} L0 ${n(h)} Z`;
  const dense = points.length > w;
  const dots = points
    .filter((_, i) => !dense || i === 0 || i === points.length - 1)
    .map((p) => ({ x: xOf(p), y: yOf(p) }));
  return { line, area, dots };
}
