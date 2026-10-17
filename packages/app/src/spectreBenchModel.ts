/**
 * Spectre's workbench geometry and readouts (record
 * `2026-10-17-spectre-drawn-cells` decision 10), pure: where the three lanes
 * and the ruler stand on the canvas, which cell and value a point is, what a
 * band's readout says, which cells the selection follows, the curve as the
 * bands hear it, and where a spectrum level stands. The drawing and the
 * pointer read only these, so `spectreBenchModel.test.ts` pins them without a
 * canvas.
 */
import type { SpectreLfoDest } from '@windsor/engine';
import {
  SPECTRE_AXIS_OCTAVES,
  SPECTRE_CELLS,
  SPECTRE_DSP,
  spectreAxisHz,
  spectreCellCentre,
  spectreCellRead,
  spectreChannelCells,
  spectreGainDb,
  spectreGridMs,
  spectreSelectionMask,
  spectreTimeMs,
} from '@windsor/engine';
import type { SpectreCurve, SpectreSpec } from '@windsor/engine';
import { cellMidi } from './spectreGenerators';
import { SPECTRE_BENCH, SPECTRE_LANES } from './spectreBenchTables';

export interface SpectreLaneBox {
  readonly curve: SpectreCurve;
  readonly top: number;
  readonly height: number;
}

export interface SpectreBenchLayout {
  readonly width: number;
  readonly height: number;
  /** Where the cells start and end across. */
  readonly left: number;
  readonly right: number;
  readonly lanes: readonly SpectreLaneBox[];
  /** The ruler's top. */
  readonly ruler: number;
}

/** The lanes stacked over the canvas, equal in height, the ruler under them. */
export function benchLayout(width: number, height: number): SpectreBenchLayout {
  const B = SPECTRE_BENCH;
  const count = SPECTRE_LANES.length;
  const laneHeight = Math.max(
    B.minLanePx,
    (height - B.rulerPx - (count - 1) * B.laneGapPx) / count,
  );
  const lanes = SPECTRE_LANES.map(({ curve }, i) => ({
    curve,
    top: i * (laneHeight + B.laneGapPx),
    height: laneHeight,
  }));
  const ruler = count * laneHeight + (count - 1) * B.laneGapPx;
  return { width, height: ruler + B.rulerPx, left: B.gutterPx, right: width - 1, lanes, ruler };
}

const PX_HALF = 0.5;

/** The width of one cell, in px. */
export const cellWidth = (layout: SpectreBenchLayout): number =>
  (layout.right - layout.left) / SPECTRE_CELLS;

/** Cell `i`'s left edge, in px. */
export const xOfCell = (layout: SpectreBenchLayout, i: number): number =>
  layout.left + i * cellWidth(layout);

/** The cell under `x`, held to the axis. */
export function cellOfX(layout: SpectreBenchLayout, x: number): number {
  const i = Math.floor((x - layout.left) / cellWidth(layout));
  return Math.min(SPECTRE_CELLS - 1, Math.max(0, i));
}

/** Where axis position `at` (0..1) stands across, in px. */
export const xOfAxis = (layout: SpectreBenchLayout, at: number): number =>
  layout.left + at * (layout.right - layout.left);

/** The lane under `y`, or undefined in a gap or the ruler. */
export const laneAt = (layout: SpectreBenchLayout, y: number): SpectreLaneBox | undefined =>
  layout.lanes.find((lane) => y >= lane.top && y < lane.top + lane.height);

/** A value's height in `lane`: 1 at the top, 0 at the bottom. */
export const yOfValue = (lane: SpectreLaneBox, value: number): number =>
  lane.top + (1 - value) * (lane.height - 1) + PX_HALF;

/** The value a height in `lane` reads, held to 0..1. */
export const valueOfY = (lane: SpectreLaneBox, y: number): number =>
  Math.min(1, Math.max(0, 1 - (y - lane.top) / (lane.height - 1)));

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;
const SEMITONES = 12;
const OCTAVE_OF_C0 = 1;
const KHZ = 1000;
const PERCENT = 100;

/** A MIDI note's name: `C4` for 60. */
export function noteName(midi: number): string {
  const n = Math.round(midi);
  return `${NOTES[((n % SEMITONES) + SEMITONES) % SEMITONES]}${Math.floor(n / SEMITONES) - OCTAVE_OF_C0}`;
}

const hz = (v: number): string => (v >= KHZ ? `${(v / KHZ).toFixed(2)}k` : `${Math.round(v)}`);

/** Cell `i`'s span on the axis, `"1.21k–1.26k Hz"`. */
export function cellSpan(i: number): string {
  const from = spectreAxisHz(i / SPECTRE_CELLS),
    to = spectreAxisHz((i + 1) / SPECTRE_CELLS);
  return `${hz(from)}–${hz(to)} Hz`;
}

/** One band's readout: where it is, and what each lane holds there, as the cells read. */
export interface SpectreReadout {
  readonly span: string;
  readonly note: string;
  readonly gain: string;
  readonly delay: string;
  readonly feedback: string;
}

const MS_PER_MINUTE = 60000;
/** Each channel's share of Spread, as the worklet's: half each way. */
const HALF_SPREAD = 0.5;
const POWER_DB = 10;
/** A power below any the scope reports, so silence has a level. */
const SILENT_POWER = 1e-20;

/** What cell `i` holds for `channel`, in the units a musician reads: dB, ms and beats, %. */
export function readout(spec: SpectreSpec, i: number, channel: 0 | 1, bpm: number): SpectreReadout {
  const value = (curve: SpectreCurve): number =>
    spectreChannelCells(spec.curves[curve], channel)[i]!;
  const db = spectreGainDb(value('gain'));
  const ms = value('delay') * spectreTimeMs(spec, bpm);
  const beats = ms / (MS_PER_MINUTE / bpm);
  return {
    span: cellSpan(i),
    note: noteName(cellMidi(i)),
    gain: db === -Infinity ? '−∞ dB' : `${db.toFixed(1).replace('-', '−')} dB`,
    delay: `${Math.round(ms)} ms · ${beats.toFixed(2)} beat`,
    feedback: `${Math.round(value('feedback') * PERCENT)}%`,
  };
}

/** The grid's step as a share of the delay's full scale, 0 when off. */
export function gridShare(spec: SpectreSpec, bpm: number): number {
  const grid = spectreGridMs(spec, bpm);
  return grid > 0 ? grid / spectreTimeMs(spec, bpm) : 0;
}

/**
 * The cells each followed pitch class marks (`pitches` a 12-bit mask), the
 * worklet's arithmetic: a cell whose centre is within `toneSemitones` of one
 * of them, in any octave.
 */
export function toneCells(pitches: number): boolean[] {
  return Array.from({ length: SPECTRE_CELLS }, (_, i) => {
    const m = cellMidi(i),
      note = Math.round(m);
    const pc = ((note % SEMITONES) + SEMITONES) % SEMITONES;
    return Math.abs(m - note) <= SPECTRE_DSP.toneSemitones && ((pitches >> pc) & 1) === 1;
  });
}

/** The selection in force: what is drawn, or, while following, the followed tones within it. */
export function activeCells(spec: SpectreSpec, pitches: number): boolean[] {
  const drawn = spectreSelectionMask(spec.selection).map((v) => v !== 0);
  if (spec.follow === 'off') return drawn;
  const any = drawn.some(Boolean);
  return toneCells(pitches).map((tone, i) => tone && (!any || drawn[i]!));
}

const MOVES: Readonly<
  Record<SpectreCurve, readonly [keyof SpectreSpec, keyof SpectreSpec, keyof SpectreSpec]>
> = {
  gain: ['gainShift', 'gainOffset', 'gainSelect'],
  delay: ['delayShift', 'delayOffset', 'delaySelect'],
  feedback: ['feedbackShift', 'feedbackOffset', 'feedbackSelect'],
};

/** The LFO's push into `dest` at level `lfo`, as `spectreAim.ts` sums it. */
function lfoPush(spec: SpectreSpec, dest: SpectreLfoDest, lfo: number): number {
  const slots = [
    [spec.lfoDest1, spec.lfoDepth1],
    [spec.lfoDest2, spec.lfoDepth2],
    [spec.lfoDest3, spec.lfoDepth3],
  ] as const;
  const sum = slots.reduce((acc, [d, depth]) => (d === dest ? acc + depth * lfo : acc), 0);
  return dest.endsWith('Shift') ? sum * SPECTRE_DSP.lfoShiftOctaves : sum;
}

/**
 * `curve` as `channel`'s bands hear it at each cell's centre: slid by its
 * Shift, Spread and the LFO, moved by its Offset and, on the active cells,
 * its Select; the arithmetic of the worklet's band map.
 */
export function heardCells(
  spec: SpectreSpec,
  curve: SpectreCurve,
  channel: 0 | 1,
  active: readonly boolean[],
  lfo: number,
): number[] {
  const [shiftKey, offsetKey, selectKey] = MOVES[curve];
  const side = channel === 0 ? -HALF_SPREAD : HALF_SPREAD;
  const shift =
    (spec[shiftKey] as number) + side * spec.spread + lfoPush(spec, shiftKey as never, lfo);
  const offset = (spec[offsetKey] as number) + lfoPush(spec, offsetKey as never, lfo);
  const select = (spec[selectKey] as number) + lfoPush(spec, selectKey as never, lfo);
  const cells = spectreChannelCells(spec.curves[curve], channel);
  const steps = spec.curves[curve].steps;
  return Array.from({ length: SPECTRE_CELLS }, (_, i) =>
    spectreCellRead(cells, spectreCellCentre(i), {
      steps,
      shiftOctaves: shift,
      octaves: SPECTRE_AXIS_OCTAVES,
      add: (c) => offset + (active[c] ? select : 0),
    }),
  );
}

/** A scope power (re² + im² of a band) as a height in `lane`, 0 at the floor and 1 at full scale. */
export function spectrumLevel(power: number, bands: number): number {
  // A full-scale sine's peak band, through the square-root window on a frame of 2 · bands.
  const fullScale = (bands * 2) / Math.PI;
  const db = POWER_DB * Math.log10(Math.max(power, SILENT_POWER) / (fullScale * fullScale));
  const { floorDb, ceilingDb } = SPECTRE_BENCH;
  return Math.min(1, Math.max(0, (db - floorDb) / (ceilingDb - floorDb)));
}
