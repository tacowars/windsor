/** Engine-owned limits/defaults; times are milliseconds and divisions are quarter-note beats. */
import { DEFAULT_DELAY, DELAY_BOUNDS } from '@windsor/engine';
import type { DelaySpec } from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';
import { fmt2, fmtDb, fmtHz } from './consoleFormat';
const fields = [
  ['leftMs', 'Left time (ms)'],
  ['rightMs', 'Right time (ms)'],
  ['feedback', 'Feedback'],
  ['highpass', 'High pass'],
  ['lowpass', 'Low pass'],
  ['drive', 'Drive (dB)'],
  ['mix', 'Dry / wet'],
  ['outputDb', 'Output'],
] as const;
export const DELAY_KNOBS: readonly InsertKnobEntry<DelaySpec>[] = fields.map(([f, label]) => ({
  f,
  label,
  o: {
    min: DELAY_BOUNDS[f][0],
    max: DELAY_BOUNDS[f][1],
    def: DEFAULT_DELAY[f],
    fmt:
      f === 'highpass' || f === 'lowpass'
        ? fmtHz
        : f === 'outputDb' || f === 'drive'
          ? fmtDb
          : fmt2,
    ...(f === 'highpass' || f === 'lowpass' || f === 'leftMs' || f === 'rightMs'
      ? { curve: 'log' as const }
      : {}),
  },
}));
export const DELAY_MODE_LABELS = {
  stereo: 'Stereo',
  'ping-pong': 'Ping pong',
  'mid-side': 'Mid / side',
} as const;
