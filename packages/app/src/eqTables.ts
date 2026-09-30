/**
 * The Parametric EQ card's data (windsor#199, record
 * `2026-09-30-parametric-eq-insert`; the look is the mockup's,
 * `docs/research/2026-09-30-parametric-eq/mockup.html`): the plot's size and
 * grid, the gestures' steps, the band types' names and glyphs, and the knobs.
 * Every range and default is the engine's (`EQ_BOUNDS`, `DEFAULT_EQ`), so
 * the console states neither again; `eqTables.test.ts` holds them in step.
 */
import type { EqBand, EqBandType, EqSlope, EqSpec } from '@windsor/engine';
import { DEFAULT_EQ, EQ_BOUNDS } from '@windsor/engine';
import { fmt2, fmtDb, fmtHz } from './consoleFormat';
import type { InsertKnobEntry } from './insertKnobTables';
import type { CardKnobSpec } from './sequencerKnobTables';

/** The curve's canvas and what is drawn on it, in CSS px. */
export const EQ_PLOT = {
  width: 384,
  height: 160,
  /** The ±range lines sit this far inside the top and the bottom. */
  pad: 8,
  /** A band's point, and how near a press must land to take it. */
  pointRadius: 7,
  hitRadius: 11,
  /** A frequency label is drawn only this far from the right edge or more. */
  labelRoom: 18,
  /** The curve past the plot is drawn this far out, so a clipped line leaves at the edge. */
  overshoot: 2,
  /** The x step of the selected band's fill, px. */
  fillStep: 2,
  /** The selected band's fill opacity. */
  fillAlpha: 0.13,
  /** A minor grid line's opacity, and a dB line's other than 0 dB. */
  minorAlpha: 0.45,
  dbLineAlpha: 0.6,
  curveWidth: 1.8,
  pointLine: 1.5,
  offPointLine: 1,
  /** The labels' offsets from their line. */
  labelInset: 2,
  dbLabelLift: 6,
  labelFont: '9px "IBM Plex Mono", monospace',
  pointFont: '600 8.5px "IBM Plex Mono", monospace',
  /** A 1 px grid line sits on a pixel's centre. */
  halfPixel: 0.5,
  /** The point's number sits this much below the centre, to look centred. */
  pointTextDrop: 0.5,
} as const;

/** The view's ± dB ranges (the plot's corner toggle), and the grid step in each. */
export const EQ_RANGES = [12, 24] as const;
export type EqRange = (typeof EQ_RANGES)[number];
export const EQ_GRID_DB: Readonly<Record<EqRange, number>> = { 12: 6, 24: 12 };

/** Every grid line's frequency, and the ones that carry a label. */
export const EQ_GRID_HZ: readonly number[] = [
  20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000,
  4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000,
];
export const EQ_GRID_LABELS: ReadonlyMap<number, string> = new Map([
  [20, '20'],
  [50, '50'],
  [100, '100'],
  [200, '200'],
  [500, '500'],
  [1000, '1k'],
  [2000, '2k'],
  [5000, '5k'],
  [10000, '10k'],
  [20000, '20k'],
]);

/** The gestures' steps (the mockup's "How you use it"). */
export const EQ_GESTURE = {
  /** Shift: every drag, wheel and key step is this share of its usual size. */
  fine: 0.2,
  /** A drag moves Q by e^(−dy / this), px. */
  qDragPx: 40,
  /** The wheel moves Q by e^(−delta / this); Shift uses the fine divisor. */
  wheelPx: 300,
  wheelFinePx: 1200,
  /** An arrow key's step: a semitone of frequency, half a dB of gain, a tenth (log) of Q. */
  keySemitones: 1,
  keyGainDb: 0.5,
  keyQLog: 0.1,
  semitonesPerOctave: 12,
  /** A bell added by double-clicking the curve starts at this Q (record decision 2). */
  addedBellQ: 1,
} as const;

/**
 * One EQ's session view (record decision 8): the band its panel edits, the
 * plot's ± range and the Listen switch. Never in the song.
 */
export interface EqView {
  readonly band: number;
  readonly range: EqRange;
  readonly listen: boolean;
}

/** Where every EQ's view starts: the mockup's (band 4, ±12 dB, Listen on). */
export const EQ_DEFAULT_VIEW: EqView = { band: 3, range: 12, listen: true };

/** The sample rate the curve is drawn at while the audio is off. */
export const EQ_FALLBACK_SAMPLE_RATE = 48000;

/** What the curve is called to a screen reader: its keys. */
export const EQ_CURVE_LABEL =
  'EQ curve. Arrow keys move the selected band; Alt with up or down changes its Q; 1 to 8 select a band.';

/** The toast a double-click on the curve raises when no band is free. */
export const EQ_FULL_MESSAGE = 'All eight bands are on. Turn one off to add another.';

/** Which way a band type reads the curve's height: gain, Q (the resonant cuts) or nothing. */
export type EqTypeRole = 'gain' | 'cut' | 'notch';

export const EQ_TYPE_ROLE: Readonly<Record<EqBandType, EqTypeRole>> = {
  lowcut: 'cut',
  lowshelf: 'gain',
  bell: 'gain',
  notch: 'notch',
  highshelf: 'gain',
  highcut: 'cut',
};

/** A cut at this slope is one first-order section: it has no Q, and its point sits on 0 dB. */
export const EQ_FIRST_ORDER_SLOPE: EqSlope = 6;

export const EQ_TYPE_LABELS: Readonly<Record<EqBandType, string>> = {
  lowcut: 'Low cut',
  lowshelf: 'Low shelf',
  bell: 'Bell',
  notch: 'Notch',
  highshelf: 'High shelf',
  highcut: 'High cut',
};

export const eqSlopeLabel = (slope: EqSlope): string => `${slope} dB/oct`;

/** Each type's glyph on its band chip: a 16 × 11 path. */
export const EQ_TYPE_GLYPHS: Readonly<Record<EqBandType, string>> = {
  lowcut: 'M1 9 C4 9 5 2 8 2 L15 2',
  highcut: 'M1 2 L8 2 C11 2 12 9 15 9',
  lowshelf: 'M1 3 L4 3 C7 3 7 7 10 7 L15 7',
  highshelf: 'M1 7 L6 7 C9 7 9 3 12 3 L15 3',
  bell: 'M1 7 L4 7 C6 7 6 2 8 2 C10 2 10 7 12 7 L15 7',
  notch: 'M1 3 L6 3 C7 3 7.5 9 8 9 C8.5 9 9 3 10 3 L15 3',
};
export const EQ_GLYPH_BOX = { width: 16, height: 11 } as const;

/** Where a band's knob stands: what a knob of a type that ignores it reads. */
export const EQ_KNOB_OFF_TEXT = '—';

const PERCENT = 100;
const fmtPercent = (v: number): string => `${Math.round(v * PERCENT)}%`;

/** A band's numeric fields, each a knob in the band panel. */
export type EqBandKnobField = 'freq' | 'gain' | 'q';

const BAND_KNOBS: Readonly<Record<EqBandKnobField, Omit<CardKnobSpec, 'def'>>> = {
  freq: { label: 'Freq', min: EQ_BOUNDS.freq[0], max: EQ_BOUNDS.freq[1], curve: 'log', fmt: fmtHz },
  gain: { label: 'Gain', min: EQ_BOUNDS.gain[0], max: EQ_BOUNDS.gain[1], fmt: fmtDb },
  q: { label: 'Q', min: EQ_BOUNDS.q[0], max: EQ_BOUNDS.q[1], curve: 'log', fmt: fmt2 },
};

/** The band at `band`'s knob for `field`: the engine's range, and that band's `DEFAULT_EQ` value. */
export function eqBandKnob(field: EqBandKnobField, band: number): CardKnobSpec {
  const fallback: EqBand | undefined = DEFAULT_EQ.bands[band];
  return { ...BAND_KNOBS[field], def: fallback ? fallback[field] : 0 };
}

/** Scale and Output: the EQ's two global knobs. */
export const EQ_GLOBAL_KNOBS: readonly InsertKnobEntry<EqSpec>[] = [
  {
    f: 'scale',
    label: 'Scale',
    o: {
      min: EQ_BOUNDS.scale[0],
      max: EQ_BOUNDS.scale[1],
      def: DEFAULT_EQ.scale,
      fmt: fmtPercent,
    },
  },
  {
    f: 'output',
    label: 'Output',
    o: {
      min: EQ_BOUNDS.output[0],
      max: EQ_BOUNDS.output[1],
      def: DEFAULT_EQ.output,
      fmt: fmtDb,
    },
  },
];
