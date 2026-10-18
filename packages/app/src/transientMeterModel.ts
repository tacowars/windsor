/**
 * The Transient card's bipolar gain meter, as values (record
 * `2026-10-18-transient-insert` decision 9): how far each half fills from
 * the center line on the engine's ±`meterCeilingDb` scale, the one number
 * the frame loop compares, and the readouts' window, which holds each
 * window's largest boost and cut so the numbers can be read while the bars
 * follow every frame. Pure, so it tests in Node.
 */
import { TRANSIENT_DSP } from '@windsor/engine';
import type { TransientShapingReading } from '@windsor/engine';
import { TRANSIENT_METER } from './transientTables';

/** A level's share of the meter's half, 0 to 1: a boost's of the upper half, a cut's of the lower. */
export function meterShare(db: number, ceilingDb: number = TRANSIENT_DSP.meterCeilingDb): number {
  return Math.min(1, Math.max(0, Math.abs(db) / ceilingDb));
}

/** Tenths of a dB a frame tells apart; a reading's key packs its boost and cut at this grain. */
const TENTHS = 10;
const CUT_SPAN = 1000;

/** One number per reading, the same for two readings that draw alike: what the frame loop compares. */
export function meterKey(reading: TransientShapingReading): number {
  const boost = Math.round(Math.max(0, reading.boost) * TENTHS);
  const cut = Math.round(Math.max(0, -reading.cut) * TENTHS);
  return boost * CUT_SPAN + Math.min(cut, CUT_SPAN - 1);
}

/** The readouts' open window: its index since time zero and its extremes so far. */
export interface MeterWindow {
  readonly index: number;
  readonly boost: number;
  readonly cut: number;
}

export const EMPTY_METER_WINDOW: MeterWindow = { index: -1, boost: 0, cut: 0 };

export interface MeterStep {
  readonly window: MeterWindow;
  /** The extremes of the window that just closed, or null while one is still open. */
  readonly shown: TransientShapingReading | null;
}

/** Adds one frame's reading at `nowMs`; a frame in a new window closes the old one. */
export function stepMeterWindow(
  open: MeterWindow,
  reading: TransientShapingReading,
  nowMs: number,
  windowMs: number = TRANSIENT_METER.readoutWindowMs,
): MeterStep {
  const index = Math.floor(nowMs / windowMs);
  if (index === open.index) {
    return {
      window: {
        index,
        boost: Math.max(open.boost, reading.boost),
        cut: Math.min(open.cut, reading.cut),
      },
      shown: null,
    };
  }
  const shown = open.index < 0 ? null : { boost: open.boost, cut: open.cut };
  return {
    window: { index, boost: Math.max(0, reading.boost), cut: Math.min(0, reading.cut) },
    shown,
  };
}
