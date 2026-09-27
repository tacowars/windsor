/** Compressor controls read ranges and defaults from the engine (#660). */
import {
  COMPRESSOR_ATTACKS,
  COMPRESSOR_RELEASES,
  COMPRESSOR_RATIOS,
  COMPRESSOR_BOUNDS,
  DEFAULT_COMPRESSOR,
} from '@windsor/engine';
import type { CompressorSpec } from '@windsor/engine';
import { fmt2, fmtDb, fmtHz } from './consoleFormat';
import type { InsertKnobEntry } from './insertKnobTables';

export const COMPRESSOR_KNOBS: readonly InsertKnobEntry<CompressorSpec>[] = [
  {
    f: 'threshold',
    label: 'Threshold',
    o: {
      min: COMPRESSOR_BOUNDS.threshold[0],
      max: COMPRESSOR_BOUNDS.threshold[1],
      def: DEFAULT_COMPRESSOR.threshold,
      fmt: fmtDb,
    },
  },
  {
    f: 'makeup',
    label: 'Makeup',
    o: {
      min: COMPRESSOR_BOUNDS.makeup[0],
      max: COMPRESSOR_BOUNDS.makeup[1],
      def: DEFAULT_COMPRESSOR.makeup,
      fmt: fmtDb,
    },
  },
  {
    f: 'highpass',
    label: 'Detector HP',
    o: {
      min: COMPRESSOR_BOUNDS.highpass[0],
      max: COMPRESSOR_BOUNDS.highpass[1],
      def: DEFAULT_COMPRESSOR.highpass,
      fmt: fmtHz,
    },
  },
  {
    f: 'range',
    label: 'Range',
    o: {
      min: COMPRESSOR_BOUNDS.range[0],
      max: COMPRESSOR_BOUNDS.range[1],
      def: DEFAULT_COMPRESSOR.range,
      fmt: fmtDb,
    },
  },
  { f: 'mix', label: 'Mix', o: { min: 0, max: 1, def: DEFAULT_COMPRESSOR.mix, fmt: fmt2 } },
];
export const COMPRESSOR_SELECTS = [
  {
    field: 'attack',
    label: 'Attack',
    values: COMPRESSOR_ATTACKS,
    format: (v: number): string => `${v} ms`,
  },
  {
    field: 'ratio',
    label: 'Ratio',
    values: COMPRESSOR_RATIOS,
    format: (v: number): string => `${v}:1`,
  },
  {
    field: 'release',
    label: 'Release',
    values: COMPRESSOR_RELEASES,
    format: (v: number): string => (v === 0 ? 'Auto' : `${v} s`),
  },
] as const;
