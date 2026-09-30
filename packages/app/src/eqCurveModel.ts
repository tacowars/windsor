/**
 * The Parametric EQ's curve, as rules (windsor#199 decision 4; the mockup's
 * "How you use it"): where each band's point sits, which point a press takes,
 * and what a drag, the wheel, a double-click or a key does to the spec. Pure:
 * every function takes values and returns new ones, and the card applies them
 * through `ctx.change`. Every response is the engine's `eqResponseDb`, never a
 * copy of its maths. Pinned by `eqCurveModel.test.ts`.
 */
import type { EqBand, EqSpec } from '@windsor/engine';
import { EQ_BOUNDS, eqResponseDb } from '@windsor/engine';
import type { EqRange, EqTypeRole } from './eqTables';
import { EQ_FIRST_ORDER_SLOPE, EQ_GESTURE, EQ_PLOT, EQ_TYPE_ROLE } from './eqTables';

/** The plot as the rules see it: its size in px and its ± dB range. */
export interface EqPlot {
  readonly width: number;
  readonly height: number;
  readonly range: EqRange;
}

export const eqPlot = (range: EqRange): EqPlot => ({
  width: EQ_PLOT.width,
  height: EQ_PLOT.height,
  range,
});

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const [F_MIN, F_MAX] = EQ_BOUNDS.freq;
const LOG_SPAN = Math.log(F_MAX / F_MIN);

export const clampFreq = (freq: number): number => clamp(freq, F_MIN, F_MAX);
export const clampGain = (gain: number): number => clamp(gain, ...EQ_BOUNDS.gain);
export const clampQ = (q: number): number => clamp(q, ...EQ_BOUNDS.q);

/** x (px from the left) of `freq`: log frequency, 10 Hz at 0 and 22 kHz at the width. */
export const xOfFreq = (freq: number, plot: EqPlot): number =>
  (Math.log(freq / F_MIN) / LOG_SPAN) * plot.width;
export const freqOfX = (x: number, plot: EqPlot): number =>
  F_MIN * Math.exp((x / plot.width) * LOG_SPAN);

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
 */
export function pointDb(spec: EqSpec, index: number, sampleRate: number): number {
  const band = spec.bands[index]!;
  const role = roleOf(band);
  if (role === 'gain') return band.gain * spec.scale;
  if (!heightIsQ(band)) return 0;
  at[0] = band.freq;
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
 * 12/24/48 cut, and nothing for a notch or a 6 dB cut; with Alt, y is Q and
 * x nothing. A drag always turns the band on.
 */
export function dragBand(start: EqDragStart, move: EqDragMove, plot: EqPlot): EqBand {
  const f = move.fine ? EQ_GESTURE.fine : 1;
  const dx = (move.x - start.x) * f;
  const dy = (move.y - start.y) * f;
  const band: EqBand = { ...start.band, on: true };
  const qSteps = -dy / EQ_GESTURE.qDragPx;
  if (move.alt) return { ...band, q: moveQ(band.q, qSteps) };
  const freq = clampFreq(freqOfX(xOfFreq(band.freq, plot) + dx, plot));
  if (roleOf(band) === 'gain' && start.scale > 0) {
    const gain = clampGain(band.gain + dbOfY(plot.height / 2 + dy, plot) / start.scale);
    return { ...band, freq, gain };
  }
  return { ...band, freq, q: heightIsQ(band) ? moveQ(band.q, qSteps) : band.q };
}

/** The band after a wheel of `delta` over its point: Q, up for a wheel away (a negative delta). */
export function wheelBand(band: EqBand, delta: number, fine: boolean): EqBand {
  return {
    ...band,
    q: moveQ(band.q, -delta / (fine ? EQ_GESTURE.wheelFinePx : EQ_GESTURE.wheelPx)),
  };
}

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
    freq: clampFreq(freqOfX(point.x, plot)),
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
 * semitone and a bell's or shelf's gain half a dB; Alt with ↑ or ↓ moves its
 * Q; Shift takes `EQ_GESTURE.fine` of each step.
 */
export function keyEdit(spec: EqSpec, selected: number, key: EqKey): EqKeyResult {
  const digit = Number(key.key);
  if (/^[1-9]$/.test(key.key) && digit <= spec.bands.length) return { select: digit - 1 };
  const arrow = Object.hasOwn(ARROWS, key.key) ? ARROWS[key.key] : undefined;
  const band = spec.bands[selected];
  if (!arrow || !band) return null;
  const f = key.shift ? EQ_GESTURE.fine : 1;
  const [across, up] = arrow;
  if (key.alt)
    return up ? { band: { ...band, q: moveQ(band.q, up * EQ_GESTURE.keyQLog * f) } } : null;
  const semitones = across * EQ_GESTURE.keySemitones * f;
  const freq = clampFreq(band.freq * 2 ** (semitones / EQ_GESTURE.semitonesPerOctave));
  const gain =
    roleOf(band) === 'gain' ? clampGain(band.gain + up * EQ_GESTURE.keyGainDb * f) : band.gain;
  return { band: { ...band, freq, gain } };
}
