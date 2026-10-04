/**
 * The Output display's Spectrum view (windsor#586 decision 5): the master's
 * spectrum on the Parametric EQ's log-frequency axis and dBFS scale, through
 * the EQ's own `spectrumLevels` and `xOfFreq`, filled in the trace colour,
 * with its loudest peaks marked and labelled one to a row. It reads the
 * analyser's frequency data only, into buffers kept between frames; a label's
 * text and width are made again only when its reading changes.
 */
import type { PeakPicker } from './scopePeaks';
import { CARRIER_COLOR } from './consoleColors';
import type { EqPlot } from './eqCurveModel';
import { eqMaxFreq, xOfFreq } from './eqCurveModel';
import { spectrumLevels } from './eqSpectrum';
import { EQ_DEFAULT_VIEW, EQ_SPECTRUM_VIEW } from './eqTables';
import { SCOPE_PEAKS, SCOPE_SPECTRUM } from './scopeConstants';
import { createPeakPicker, peakLabel } from './scopePeaks';

export interface SpectrumDrawer {
  /** Draw `node`'s spectrum into a `w` × `h` (CSS px) canvas. */
  draw(g: CanvasRenderingContext2D, node: AnalyserNode, w: number, h: number): void;
}

/** What the view keeps between frames. */
interface SpectrumState {
  bins: Float32Array<ArrayBuffer>;
  /** The curve's height per column, px from the top. */
  levels: Float64Array;
  plot: EqPlot | null;
  rate: number;
  readonly picker: PeakPicker;
  /** Each label slot's reading in steps of the label's resolution, its text and its width. */
  readonly labelStep: Float64Array;
  readonly labelText: string[];
  readonly labelWidth: Float64Array;
}

/** The plot for this canvas size and sample rate, made again only when either changes. */
function plotFor(s: SpectrumState, w: number, h: number, sampleRate: number): EqPlot {
  if (s.plot && s.plot.width === w && s.plot.height === h && s.rate === sampleRate) return s.plot;
  s.rate = sampleRate;
  s.plot = { width: w, height: h, range: EQ_DEFAULT_VIEW.range, maxFreq: eqMaxFreq(sampleRate) };
  s.levels = new Float64Array(Math.floor(w / EQ_SPECTRUM_VIEW.step) + 2);
  return s.plot;
}

/** The first `n` columns of the curve, filled under and stroked along the top. */
function curve(g: CanvasRenderingContext2D, s: SpectrumState, n: number, p: EqPlot): void {
  g.beginPath();
  g.moveTo(0, p.height);
  for (let i = 0; i < n; i++) g.lineTo(i * EQ_SPECTRUM_VIEW.step, s.levels[i]!);
  g.lineTo(p.width, p.height);
  g.closePath();
  g.fillStyle = CARRIER_COLOR;
  g.globalAlpha = SCOPE_SPECTRUM.fillAlpha;
  g.fill();
  g.globalAlpha = 1;
  g.beginPath();
  for (let i = 0; i < n; i++) g.lineTo(i * EQ_SPECTRUM_VIEW.step, s.levels[i]!);
  g.strokeStyle = CARRIER_COLOR;
  g.lineWidth = SCOPE_SPECTRUM.lineWidth;
  g.stroke();
}

/** The label of peak `i`, written and measured only when its reading changes. */
function label(g: CanvasRenderingContext2D, s: SpectrumState, i: number): string {
  const hz = s.picker.hz[i]!;
  const step = Math.round(hz / SCOPE_SPECTRUM.labelResolutionHz);
  if (s.labelStep[i] !== step) {
    s.labelStep[i] = step;
    s.labelText[i] = peakLabel(hz);
    s.labelWidth[i] = g.measureText(s.labelText[i]).width;
  }
  return s.labelText[i]!;
}

/** The first `n` peaks: a marker on the curve, and a label on its own row, inside the canvas. */
function peaks(g: CanvasRenderingContext2D, s: SpectrumState, n: number, p: EqPlot): void {
  const v = SCOPE_SPECTRUM;
  g.font = v.labelFont;
  g.fillStyle = CARRIER_COLOR;
  for (let i = 0; i < n; i++) {
    const x = xOfFreq(s.picker.hz[i]!, p);
    // The marker sits on the drawn curve, at its nearest column.
    const column = Math.round(x / EQ_SPECTRUM_VIEW.step);
    g.beginPath();
    g.arc(
      x,
      s.levels[Math.min(s.levels.length - 1, Math.max(0, column))]!,
      v.markerRadius,
      0,
      2 * Math.PI,
    );
    g.fill();
    const text = label(g, s, i);
    const right = p.width - v.labelInset - s.labelWidth[i]!;
    const tx = Math.max(v.labelInset, Math.min(right, x + v.labelGap));
    const ty = Math.min(p.height - v.labelInset, v.labelTop + i * v.labelRow);
    g.fillText(text, tx, ty);
  }
}

export function createSpectrumDrawer(): SpectrumDrawer {
  const s: SpectrumState = {
    bins: new Float32Array(0),
    levels: new Float64Array(0),
    plot: null,
    rate: 0,
    picker: createPeakPicker(),
    labelStep: new Float64Array(SCOPE_PEAKS.count).fill(NaN),
    labelText: new Array<string>(SCOPE_PEAKS.count).fill(''),
    labelWidth: new Float64Array(SCOPE_PEAKS.count),
  };
  return {
    draw(g, node, w, h) {
      if (s.bins.length !== node.frequencyBinCount)
        s.bins = new Float32Array(node.frequencyBinCount);
      node.getFloatFrequencyData(s.bins);
      const sampleRate = node.context.sampleRate;
      const binHz = sampleRate / node.fftSize;
      const p = plotFor(s, w, h, sampleRate);
      curve(g, s, spectrumLevels(s.bins, binHz, p, s.levels), p);
      peaks(g, s, s.picker.pick(s.bins, binHz, p.maxFreq), p);
    },
  };
}
