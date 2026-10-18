/**
 * The Transient card's tables (record `2026-10-18-transient-insert`
 * decision 9): its four knobs on the engine's bounds and defaults, their
 * readouts (signed dB, and Mix in percent), and the gain meter's labels and
 * readout window.
 */
import { DEFAULT_TRANSIENT, TRANSIENT_BOUNDS } from '@windsor/engine';
import type { TransientSpec } from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';

const PERCENT = 100;
const DB_PLACES = 1;

/** A level in dB, signed, one decimal, with its unit: `+3.0 dB`; a value that rounds to 0 is `0.0 dB`. */
export function fmtSignedDb(v: number): string {
  const text = v.toFixed(DB_PLACES);
  if (Number(text) === 0) return `${(0).toFixed(DB_PLACES)} dB`;
  return `${v > 0 ? '+' : ''}${text} dB`;
}

/** A share 0..1 as a whole percentage. */
export const fmtPercent = (v: number): string => `${Math.round(v * PERCENT)}%`;

const B = TRANSIENT_BOUNDS;
const D = DEFAULT_TRANSIENT;

export const TRANSIENT_KNOBS: readonly InsertKnobEntry<TransientSpec>[] = [
  {
    f: 'attack',
    label: 'Attack',
    o: { min: B.attack[0], max: B.attack[1], def: D.attack, fmt: fmtSignedDb },
  },
  {
    f: 'sustain',
    label: 'Sustain',
    o: { min: B.sustain[0], max: B.sustain[1], def: D.sustain, fmt: fmtSignedDb },
  },
  {
    f: 'output',
    label: 'Output',
    o: { min: B.output[0], max: B.output[1], def: D.output, fmt: fmtSignedDb },
  },
  { f: 'mix', label: 'Mix', o: { min: B.mix[0], max: B.mix[1], def: D.mix, fmt: fmtPercent } },
];

export const TRANSIENT_METER = {
  label: 'Transient gain',
  /** The readouts hold each window's largest boost and cut this long, so they can be read. */
  readoutWindowMs: 500,
} as const;
