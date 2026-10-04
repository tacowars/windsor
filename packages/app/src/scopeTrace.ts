/**
 * The Output display's time-domain views (windsor#586 decisions 3 and 4):
 * Scope, the newest `SCOPE_WINDOW` samples from a rising zero crossing, as
 * the display has always drawn them; and Cycle, two periods of the playing
 * note across the full width, auto-gained, falling back to Scope's trace when
 * no period is clear. Both read the analyser's time-domain data only, into a
 * buffer kept between frames.
 */
import { CARRIER_COLOR, HOT_COLOR } from './consoleColors';
import { SCOPE_CLIP_PEAK, SCOPE_CYCLE, SCOPE_TRACE_WIDTH, SCOPE_WINDOW } from './scopeConstants';
import type { PeriodDetector } from './scopePeriod';
import { createPeriodDetector, risingCrossing } from './scopePeriod';

/** The trace keeps this many px clear of the canvas's top and bottom. */
const EDGE = 2;

export interface TraceDrawer {
  /** Draw `node`'s newest samples into a `w` × `h` (CSS px) canvas: the Cycle view if `cycle`. */
  draw(g: CanvasRenderingContext2D, node: AnalyserNode, cycle: boolean, w: number, h: number): void;
}

/** The trace's stroke: hot when the true peak is about to clip. */
function stroke(g: CanvasRenderingContext2D, peak: number): void {
  g.strokeStyle = peak > SCOPE_CLIP_PEAK ? HOT_COLOR : CARRIER_COLOR;
  g.lineWidth = SCOPE_TRACE_WIDTH;
}

/** Scope: the newest `2 × SCOPE_WINDOW` samples, drawn from the first rising zero crossing in their first half. */
function drawScope(g: CanvasRenderingContext2D, buffer: Float32Array, w: number, h: number): void {
  const offset = Math.max(0, buffer.length - 2 * SCOPE_WINDOW);
  const half = (buffer.length - offset) >> 1;
  // Trigger on a rising zero crossing so the trace holds still.
  let start = offset;
  for (let i = 1; i < half; i++) {
    if ((buffer[offset + i - 1] ?? 0) <= 0 && (buffer[offset + i] ?? 0) > 0) {
      start = offset + i;
      break;
    }
  }
  let peak = 0;
  for (let i = offset; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i] ?? 0));

  stroke(g, peak);
  g.beginPath();
  for (let i = 0; i < half; i++) {
    const v = buffer[start + i] ?? 0;
    const x = (i / half) * w;
    const y = h / 2 - v * (h / 2 - EDGE);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

/** `buffer` at fractional index `t`, on the Catmull-Rom curve through its samples. */
function sampleAt(buffer: Float32Array, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const last = buffer.length - 1;
  const p0 = buffer[Math.max(0, i - 1)]!;
  const p1 = buffer[Math.min(last, i)]!;
  const p2 = buffer[Math.min(last, i + 1)]!;
  const p3 = buffer[Math.min(last, i + 2)]!;
  const slope1 = (p2 - p0) / 2;
  const slope2 = (p3 - p1) / 2;
  const d = p2 - p1;
  return p1 + f * (slope1 + f * (2 * d - 2 * slope1 + d - slope2 + f * (slope1 + slope2 - 2 * d)));
}

/** The largest |sample| of `buffer` from `start` across `span`. */
function peakOver(buffer: Float32Array, start: number, span: number): number {
  let peak = 0;
  const end = Math.min(buffer.length - 1, Math.ceil(start + span));
  for (let i = Math.max(0, Math.floor(start)); i <= end; i++)
    peak = Math.max(peak, Math.abs(buffer[i]!));
  return peak;
}

/** Cycle: `SCOPE_CYCLE.periods` periods of `period` samples, the newest that start on a rising crossing. */
function drawCycle(
  g: CanvasRenderingContext2D,
  buffer: Float32Array,
  period: number,
  w: number,
  h: number,
): void {
  const span = SCOPE_CYCLE.periods * period;
  const from = Math.max(1, buffer.length - 1 - span - period);
  const start = risingCrossing(buffer, from, from + period);
  const peak = peakOver(buffer, start, span);
  const gain = peak > 0 ? Math.min(SCOPE_CYCLE.maxGain, SCOPE_CYCLE.fill / peak) : 1;
  const scale = gain * (h / 2 - EDGE);

  stroke(g, peak);
  g.beginPath();
  g.moveTo(0, h / 2 - sampleAt(buffer, start) * scale);
  if (span >= w) {
    // More samples than px: through every sample.
    const end = Math.min(start + span, buffer.length - 1);
    for (let i = Math.ceil(start); i < end; i++)
      g.lineTo(((i - start) / span) * w, h / 2 - buffer[i]! * scale);
  } else {
    // Fewer: a point per px, on the curve between them.
    for (let x = 1; x < w; x++)
      g.lineTo(x, h / 2 - sampleAt(buffer, start + (x / w) * span) * scale);
  }
  g.lineTo(w, h / 2 - sampleAt(buffer, start + span) * scale);
  g.stroke();
}

export function createTraceDrawer(): TraceDrawer {
  let buffer: Float32Array<ArrayBuffer> | null = null;
  let detector: PeriodDetector | null = null;
  let rate = 0;
  return {
    draw(g, node, cycle, w, h) {
      if (!buffer || buffer.length !== node.fftSize) buffer = new Float32Array(node.fftSize);
      node.getFloatTimeDomainData(buffer);
      if (cycle) {
        const sampleRate = node.context.sampleRate;
        if (!detector || detector.length !== buffer.length || rate !== sampleRate) {
          detector = createPeriodDetector({ sampleRate, length: buffer.length });
          rate = sampleRate;
        }
        const period = detector.detect(buffer);
        if (period > 0) return drawCycle(g, buffer, period, w, h);
      }
      drawScope(g, buffer, w, h);
    },
  };
}
