/**
 * The Parametric EQ's curve, as rules (windsor#199 decision 4; the mockup's
 * "How you use it"): where each band's point sits, which point a press takes,
 * and what a drag, the wheel, a double-click or a key does to the spec. Pure:
 * every function takes values and returns new ones, and the card applies them
 * through `ctx.change`. Every response is the engine's `eqResponseDb`, never a
 * copy of its maths. Pinned by `eqCurveModel.test.ts`.
 */
import type { EqBand, EqSpec } from '@windsor/engine';
import { EQ_BOUNDS, EQ_DSP, eqResponseDb } from '@windsor/engine';
import type { EqRange, EqTypeRole } from './eqTables';
import {
  EQ_FALLBACK_SAMPLE_RATE,
  EQ_FIRST_ORDER_SLOPE,
  EQ_GESTURE,
  EQ_PLOT,
  EQ_TYPE_ROLE,
} from './eqTables';

/**
 * The plot as the rules see it: its size in px, its ± dB range, and the
 * frequency at its right edge, the highest the engine plays at the sample rate.
 */
export interface EqPlot {
  readonly width: number;
  readonly height: number;
  readonly range: EqRange;
  readonly maxFreq: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const [F_MIN, F_MAX] = EQ_BOUNDS.freq;

/**
 * The highest frequency a band plays at `sampleRate`: the range's top, or
 * lower where the engine's design holds a band below Nyquist (`EQ_DSP`).
 */
export const eqMaxFreq = (sampleRate: number): number =>
  Math.min(F_MAX, sampleRate * EQ_DSP.maxFrequencyRatio);

export const eqPlot = (range: EqRange, sampleRate: number = EQ_FALLBACK_SAMPLE_RATE): EqPlot => ({
  width: EQ_PLOT.width,
  height: EQ_PLOT.height,
  range,
  maxFreq: eqMaxFreq(sampleRate),
});

/** `freq` inside what `plot` can reach: 10 Hz up to its right edge. */
export const clampFreq = (freq: number, plot: EqPlot): number => clamp(freq, F_MIN, plot.maxFreq);
export const clampGain = (gain: number): number => clamp(gain, ...EQ_BOUNDS.gain);
export const clampQ = (q: number): number => clamp(q, ...EQ_BOUNDS.q);

const logSpan = (plot: EqPlot): number => Math.log(plot.maxFreq / F_MIN);
/** x (px from the left) of `freq`: log frequency, 10 Hz at 0 and `plot.maxFreq` at the width. */
export const xOfFreq = (freq: number, plot: EqPlot): number =>
  (Math.log(freq / F_MIN) / logSpan(plot)) * plot.width;
export const freqOfX = (x: number, plot: EqPlot): number =>
  F_MIN * Math.exp((x / plot.width) * logSpan(plot));

/** Half the plot's height less its pad: how many px the range spans either side of 0 dB. */
const halfSpan = (plot: EqPlot): number => plot.height / 2 - EQ_PLOT.pad;
export const yOfDb = (db: number, plot: EqPlot): number =>
  plot.height / 2 - (db / plot.range) * halfSpan(plot);
export const dbOfY = (y: number, plot: EqPlot): number =>
  ((plot.height / 2 - y) / halfSpan(plot)) * plot.range;

/** How `band`'s type reads the curve's height. */
export const roleOf = (band: EqBand): EqTypeRole => EQ_TYPE_ROLE[band.type];
/** Whether `band` has a Q at all: every type but a 6 dB/oct cut. */
export const hasQ = (band: EqBand): boolean =>
  !(roleOf(band) === 'cut' && band.slope === EQ_FIRST_ORDER_SLOPE);
/** Whether up and down move `band`'s Q (a resonant cut) rather than its gain or nothing. */
const heightIsQ = (band: EqBand): boolean => roleOf(band) === 'cut' && hasQ(band);

/** `spec` with only the band at `index` playing, at no output gain: that band's own curve. */
export function soloBand(spec: EqSpec, index: number): EqSpec {
  return {
    ...spec,
    enabled: true,
    output: 0,
    bands: spec.bands.map((band, i) => ({ ...band, on: i === index })),
  };
}

const one = new Float64Array(1);
const at = new Float64Array(1);

/**
 * The dB a band's point sits at: a bell's or shelf's gain times Scale, a
 * 12/24/48 cut's response at its corner, and 0 dB for a notch or a 6 dB cut.
 * The corner is the one the engine designs the filter at: a band stored past
 * the plot's right edge is read at that edge (`eqMaxFreq`), where it is drawn.
 */
export function pointDb(spec: EqSpec, index: number, sampleRate: number): number {
  const band = spec.bands[index]!;
  const role = roleOf(band);
  if (role === 'gain') return band.gain * spec.scale;
  if (!heightIsQ(band)) return 0;
  at[0] = Math.min(band.freq, eqMaxFreq(sampleRate));
  return eqResponseDb(soloBand(spec, index), at, sampleRate, one)[0]!;
}

/** Where the band at `index` is drawn, clamped inside the plot by the point's radius. */
export function pointAt(
  spec: EqSpec,
  index: number,
  plot: EqPlot,
  sampleRate: number,
): { readonly x: number; readonly y: number } {
  const r = EQ_PLOT.pointRadius;
  const band = spec.bands[index]!;
  return {
    x: clamp(xOfFreq(band.freq, plot), r, plot.width - r),
    y: clamp(yOfDb(pointDb(spec, index, sampleRate), plot), r, plot.height - r),
  };
}

/** The band whose point is nearest (`x`, `y`) within the hit radius, or −1. */
export function hitBand(
  spec: EqSpec,
  point: { readonly x: number; readonly y: number },
  plot: EqPlot,
  sampleRate: number,
): number {
  let best = -1;
  let bestSq = EQ_PLOT.hitRadius * EQ_PLOT.hitRadius;
  spec.bands.forEach((_, i) => {
    const p = pointAt(spec, i, plot, sampleRate);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d < bestSq) {
      bestSq = d;
      best = i;
    }
  });
  return best;
}

/** `spec` with the band at `index` replaced by `band`: the whole next `bands` list. */
export function withBand(spec: EqSpec, index: number, band: EqBand): EqSpec {
  return { ...spec, bands: spec.bands.map((b, i) => (i === index ? band : b)) };
}

/** `q` moved by `steps` in log (e^steps), inside the range. */
const moveQ = (q: number, steps: number): number => clampQ(q * Math.exp(steps));

/** A drag from its press: the band as it was, Scale, and where the pointer went down. */
export interface EqDragStart {
  readonly band: EqBand;
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** Where the pointer is now, and the modifiers held. */
export interface EqDragMove {
  readonly x: number;
  readonly y: number;
  /** Shift: every step at `EQ_GESTURE.fine` of its size. */
  readonly fine: boolean;
  /** Alt: up and down move Q, for any type, and left and right nothing. */
  readonly alt: boolean;
}

/**
 * The band a drag leaves: x is frequency (log); y is gain for a bell or a
 * shelf (the drawn gain, so divided by Scale; none at Scale 0), Q for a
 * 12/24/48 cut, and nothing for a notch or a 6 dB cut; with Alt, y is Q (none
 * for a 6 dB cut, which has no Q) and x nothing. A drag always turns the band
 * on. No move across leaves the stored frequency, even one past the plot.
 */
export function dragBand(start: EqDragStart, move: EqDragMove, plot: EqPlot): EqBand {
  const f = move.fine ? EQ_GESTURE.fine : 1;
  const dx = (move.x - start.x) * f;
  const dy = (move.y - start.y) * f;
  const band: EqBand = { ...start.band, on: true };
  const qSteps = -dy / EQ_GESTURE.qDragPx;
  if (move.alt) return hasQ(band) ? { ...band, q: moveQ(band.q, qSteps) } : band;
  const freq = dx === 0 ? band.freq : clampFreq(freqOfX(xOfFreq(band.freq, plot) + dx, plot), plot);
  if (roleOf(band) === 'gain' && start.scale > 0) {
    const gain = clampGain(band.gain + dbOfY(plot.height / 2 + dy, plot) / start.scale);
    return { ...band, freq, gain };
  }
  return { ...band, freq, q: heightIsQ(band) ? moveQ(band.q, qSteps) : band.q };
}

/** `WheelEvent.deltaMode`'s units: pixels, lines and pages. */
export const WHEEL_DELTA_MODE = { pixel: 0, line: 1, page: 2 } as const;

/**
 * A wheel's `delta` in px, whatever unit its `deltaMode` reports, so a notch
 * turns Q alike on every device: a line is `EQ_GESTURE.wheelLinePx`, a page is
 * `pageHeight` (the plot's).
 */
export function wheelPixels(delta: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === WHEEL_DELTA_MODE.line) return delta * EQ_GESTURE.wheelLinePx;
  if (deltaMode === WHEEL_DELTA_MODE.page) return delta * pageHeight;
  return delta;
}

/**
 * The band after a wheel of `delta` px over its point: Q, up for a wheel away
 * (a negative delta); a 6 dB cut, which has no Q, as it was.
 */
export function wheelBand(band: EqBand, delta: number, fine: boolean): EqBand {
  if (!hasQ(band)) return band;
  return {
    ...band,
    q: moveQ(band.q, -delta / (fine ? EQ_GESTURE.wheelFinePx : EQ_GESTURE.wheelPx)),
  };
}

/**
 * Whether a wheel tick over band `band` continues the open Q step, whose
 * ticks turned band `last` (-1 before any): only the same band's ticks merge,
 * so each band's wheel edits undo on their own.
 */
export const wheelContinues = (last: number, band: number): boolean => last >= 0 && last === band;

/** What a double-click on the curve did: which band it took, and the spec after it. */
export type EqDoubleClick =
  | { readonly kind: 'reset' | 'add'; readonly band: number; readonly spec: EqSpec }
  | { readonly kind: 'full' };

/**
 * A double-click at (`x`, `y`). On a point: that band's gain back to 0 dB.
 * On empty curve: the first band that is off becomes a Bell at Q 1 there,
 * its gain the clicked gain divided by Scale and clamped, so its point lands
 * where the click was (0 dB at Scale 0). With every band on, `full`.
 */
export function doubleClick(
  spec: EqSpec,
  point: { readonly x: number; readonly y: number },
  plot: EqPlot,
  sampleRate: number,
): EqDoubleClick {
  const hit = hitBand(spec, point, plot, sampleRate);
  if (hit >= 0)
    return {
      kind: 'reset',
      band: hit,
      spec: withBand(spec, hit, { ...spec.bands[hit]!, gain: 0 }),
    };
  const free = spec.bands.findIndex((band) => !band.on);
  if (free < 0) return { kind: 'full' };
  const gain = spec.scale > 0 ? clampGain(dbOfY(point.y, plot) / spec.scale) : 0;
  const bell: EqBand = {
    ...spec.bands[free]!,
    on: true,
    type: 'bell',
    freq: clampFreq(freqOfX(point.x, plot), plot),
    gain,
    q: EQ_GESTURE.addedBellQ,
  };
  return { kind: 'add', band: free, spec: withBand(spec, free, bell) };
}

/** A key pressed while the curve has focus. */
export interface EqKey {
  readonly key: string;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** What a key does: select a band, replace the selected band, or nothing. */
export type EqKeyResult = { readonly select: number } | { readonly band: EqBand } | null;

const ARROWS: Readonly<Record<string, readonly [x: number, y: number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/**
 * `1`–`8` select that band; the arrows move the selected band's frequency a
 * semitone (inside `plot`) and a bell's or shelf's gain half a dB; Alt with ↑
 * or ↓ moves its Q (nothing for a 6 dB cut, which has none); Shift takes
 * `EQ_GESTURE.fine` of each step.
 */
export function keyEdit(spec: EqSpec, selected: number, key: EqKey, plot: EqPlot): EqKeyResult {
  const digit = Number(key.key);
  if (/^[1-9]$/.test(key.key) && digit <= spec.bands.length) return { select: digit - 1 };
  const arrow = Object.hasOwn(ARROWS, key.key) ? ARROWS[key.key] : undefined;
  const band = spec.bands[selected];
  if (!arrow || !band) return null;
  const f = key.shift ? EQ_GESTURE.fine : 1;
  const [across, up] = arrow;
  if (key.alt)
    return up && hasQ(band)
      ? { band: { ...band, q: moveQ(band.q, up * EQ_GESTURE.keyQLog * f) } }
      : null;
  const semitones = across * EQ_GESTURE.keySemitones * f;
  const freq = across
    ? clampFreq(band.freq * 2 ** (semitones / EQ_GESTURE.semitonesPerOctave), plot)
    : band.freq;
  const gain =
    roleOf(band) === 'gain' ? clampGain(band.gain + up * EQ_GESTURE.keyGainDb * f) : band.gain;
  return { band: { ...band, freq, gain } };
}
