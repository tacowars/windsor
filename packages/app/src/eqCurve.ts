/**
 * The Parametric EQ's curve, drawn (windsor#199; the mockup's plot): the
 * log-frequency grid and the ± dB lines, the selected band's own curve
 * filled in `--carrier`, the whole EQ's curve in the rack's accent (`--kc`)
 * and a numbered point per band. Every line is the engine's `eqResponseDb`
 * at the running sample rate; where a point sits is `eqCurveModel.ts`'s. The
 * background stays empty until the spectrum (windsor#200).
 */
import type { EqSpec } from '@windsor/engine';
import { eqResponseDb } from '@windsor/engine';
import { CARRIER_COLOR, LINE_COLOR } from './consoleColors';
import type { EqPlot } from './eqCurveModel';
import { freqOfX, pointAt, soloBand, xOfFreq, yOfDb } from './eqCurveModel';
import { EQ_GRID_DB, EQ_GRID_HZ, EQ_GRID_LABELS, EQ_PLOT } from './eqTables';

/** The colours a curve is drawn in. */
export interface EqPalette {
  /** The rack's accent: the curve and an unselected point's ring. */
  readonly accent: string;
  readonly carrier: string;
  readonly line: string;
  readonly ink: string;
  readonly faint: string;
  readonly inset: string;
}

/**
 * The palette where `canvas` stands: the accent and the inks from the rack's
 * custom properties (so a send bus's rack draws in its own accent), the rest
 * from `consoleColors.ts`. Read once the canvas is in the page.
 */
export function eqPalette(canvas: HTMLElement): EqPalette {
  const style = getComputedStyle(canvas);
  const read = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    accent: read('--kc', CARRIER_COLOR),
    carrier: CARRIER_COLOR,
    line: LINE_COLOR,
    ink: read('--ink', CARRIER_COLOR),
    faint: read('--ink-faint', LINE_COLOR),
    inset: read('--inset', LINE_COLOR),
  };
}

/** What one frame draws. */
export interface EqDrawState {
  readonly spec: EqSpec;
  readonly selected: number;
  readonly plot: EqPlot;
  readonly sampleRate: number;
  readonly palette: EqPalette;
}

/** The frequency at each x of the plot, 0 … width, and the response there. */
const freqs = new Float64Array(EQ_PLOT.width + 1);
const response = new Float64Array(EQ_PLOT.width + 1);

/** Size `canvas` for the plot at the screen's pixel ratio and return its context, or null. */
export function eqCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(EQ_PLOT.width * ratio);
  canvas.height = Math.round(EQ_PLOT.height * ratio);
  const g = canvas.getContext('2d');
  g?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return g;
}

function grid(g: CanvasRenderingContext2D, { plot, palette }: EqDrawState): void {
  const { width, height, range } = plot;
  g.lineWidth = 1;
  g.font = EQ_PLOT.labelFont;
  g.textBaseline = 'bottom';
  g.strokeStyle = palette.line;
  g.fillStyle = palette.faint;
  for (const hz of EQ_GRID_HZ) {
    const x = Math.round(xOfFreq(hz, plot)) + EQ_PLOT.halfPixel;
    const label = EQ_GRID_LABELS.get(hz);
    g.globalAlpha = label ? 1 : EQ_PLOT.minorAlpha;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, height);
    g.stroke();
    g.globalAlpha = 1;
    if (label && x < width - EQ_PLOT.labelRoom)
      g.fillText(label, x + EQ_PLOT.labelInset, height - 1);
  }
  const step = EQ_GRID_DB[range];
  g.textBaseline = 'middle';
  for (let db = step - range; db < range; db += step) {
    const y = Math.round(yOfDb(db, plot)) + EQ_PLOT.halfPixel;
    g.globalAlpha = db === 0 ? 1 : EQ_PLOT.dbLineAlpha;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(width, y);
    g.stroke();
    g.globalAlpha = 1;
    g.fillText(`${db > 0 ? '+' : ''}${db}`, EQ_PLOT.labelInset + 1, y - EQ_PLOT.dbLabelLift);
  }
}

const clampY = (y: number, plot: EqPlot): number =>
  Math.min(plot.height + EQ_PLOT.overshoot, Math.max(-EQ_PLOT.overshoot, y));

/** The response of `spec` at every x into `response`. */
function respond(spec: EqSpec, s: EqDrawState): void {
  for (let x = 0; x <= s.plot.width; x++) freqs[x] = freqOfX(x, s.plot);
  eqResponseDb(spec, freqs, s.sampleRate, response);
}

function selectedFill(g: CanvasRenderingContext2D, s: EqDrawState): void {
  if (!s.spec.bands[s.selected]?.on) return;
  respond(soloBand(s.spec, s.selected), s);
  const zero = yOfDb(0, s.plot);
  g.beginPath();
  g.moveTo(0, zero);
  for (let x = 0; x <= s.plot.width; x += EQ_PLOT.fillStep)
    g.lineTo(x, clampY(yOfDb(response[x]!, s.plot), s.plot));
  g.lineTo(s.plot.width, zero);
  g.closePath();
  g.fillStyle = s.palette.carrier;
  g.globalAlpha = EQ_PLOT.fillAlpha;
  g.fill();
  g.globalAlpha = 1;
}

function wholeCurve(g: CanvasRenderingContext2D, s: EqDrawState): void {
  respond(s.spec, s);
  g.beginPath();
  for (let x = 0; x <= s.plot.width; x++) {
    const y = clampY(yOfDb(response[x]!, s.plot), s.plot);
    if (x) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.strokeStyle = s.spec.enabled ? s.palette.accent : s.palette.faint;
  g.lineWidth = EQ_PLOT.curveWidth;
  g.stroke();
}

function points(g: CanvasRenderingContext2D, s: EqDrawState): void {
  const { palette } = s;
  g.font = EQ_PLOT.pointFont;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  s.spec.bands.forEach((band, i) => {
    const { x, y } = pointAt(s.spec, i, s.plot, s.sampleRate);
    g.beginPath();
    g.arc(x, y, EQ_PLOT.pointRadius, 0, Math.PI * 2);
    g.fillStyle = band.on && i === s.selected ? palette.carrier : palette.inset;
    g.fill();
    if (!band.on || i !== s.selected) {
      g.strokeStyle = band.on ? palette.accent : palette.faint;
      g.lineWidth = band.on ? EQ_PLOT.pointLine : EQ_PLOT.offPointLine;
      g.stroke();
    }
    g.fillStyle = !band.on ? palette.faint : i === s.selected ? palette.inset : palette.ink;
    g.fillText(String(i + 1), x, y + EQ_PLOT.pointTextDrop);
  });
  g.textAlign = 'left';
}

/** Draw one frame of the curve. */
export function drawEqCurve(g: CanvasRenderingContext2D, s: EqDrawState): void {
  g.clearRect(0, 0, s.plot.width, s.plot.height);
  grid(g, s);
  selectedFill(g, s);
  wholeCurve(g, s);
  points(g, s);
}
