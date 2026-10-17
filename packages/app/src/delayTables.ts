/** Engine-owned limits/defaults; times are milliseconds and divisions are quarter-note beats. */
import { DEFAULT_DELAY, DELAY_BOUNDS } from '@windsor/engine';
import type { DelaySpec } from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';
import { fmt0, fmt2, fmtDb, fmtHz } from './consoleFormat';

const PERCENT = 100;
const fmtPercent = (v: number): string => `${Math.round(v * PERCENT)}%`;
const fmtOctaves = (v: number): string => `${v.toFixed(2)}oct`;
/** Damping is a cut: its dB reads as one. */
const fmtCut = (v: number): string => fmtDb(-v);

type DelayNumber = keyof typeof DELAY_BOUNDS;
const fields: readonly [DelayNumber, string, (v: number) => string, 'log'?][] = [
  ['leftMs', 'Left time (ms)', fmt0, 'log'],
  ['rightMs', 'Right time (ms)', fmt0, 'log'],
  ['feedback', 'Feedback', fmtPercent],
  ['cross', 'Cross', fmtPercent],
  ['lowCut', 'Low cut', fmtHz, 'log'],
  ['cutoff', 'Cutoff', fmtHz, 'log'],
  ['resonance', 'Resonance', fmtDb],
  ['width', 'Width', fmtOctaves],
  ['drive', 'Drive', fmtDb],
  ['damping', 'Damping', fmtCut],
  ['dampingHz', 'Damp from', fmtHz, 'log'],
  ['modRate', 'Rate (Hz)', fmt2, 'log'],
  ['wow', 'Wow', fmtPercent],
  ['sweep', 'Sweep', fmtOctaves],
  ['mix', 'Dry / wet', fmtPercent],
  ['outputDb', 'Output', fmtDb],
];
export const DELAY_KNOBS: readonly InsertKnobEntry<DelaySpec>[] = fields.map(
  ([f, label, fmt, curve]) => ({
    f,
    label,
    o: {
      min: DELAY_BOUNDS[f][0],
      max: DELAY_BOUNDS[f][1],
      def: DEFAULT_DELAY[f],
      fmt,
      ...(curve ? { curve } : {}),
    },
  }),
);
export const DELAY_MODE_LABELS = {
  stereo: 'Stereo',
  'ping-pong': 'Ping pong',
  'mid-side': 'Mid / side',
} as const;
export const DELAY_FILTER_LABELS = {
  lowpass: 'Low pass',
  highpass: 'High pass',
  bandpass: 'Band pass',
  peak: 'Peak',
} as const;
export const DELAY_CHARACTER_LABELS = { warm: 'Warm', fold: 'Fold' } as const;
export const DELAY_WAVE_LABELS = {
  sine: 'Sine',
  triangle: 'Triangle',
  random: 'Random',
  drift: 'Drift',
} as const;
