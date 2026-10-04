/**
 * The Output display's Spectrum view (windsor#586 decision 5): the loudest
 * peaks of the master's spectrum, and what their labels read. Pure and
 * allocation-free per call: a picker owns the arrays it writes its peaks to.
 *
 * A peak is a local maximum above the floor. The loudest is taken first, and
 * any other maximum within about a semitone of a louder peak (or a few bins,
 * where a semitone is narrower than the window's main lobe) is that peak's
 * shoulder, not a peak of its own. Each peak's frequency is read between its
 * bins on the parabola through the three around it. Pinned by
 * `scopePeaks.test.ts`.
 */
import { SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { noteName } from './consoleFormat';
import { SCOPE_PEAKS, SCOPE_TUNING } from './scopeConstants';
import { vertexOffset, vertexValue } from './scopeParabola';

/** The picker's tunables: `SCOPE_PEAKS`'s shape. */
export interface PeakTable {
  readonly count: number;
  readonly floorDb: number;
  readonly semitones: number;
  readonly minBins: number;
  readonly minHz: number;
}

/** The peaks a picker last found, loudest first, `count` slots of them. */
export interface PeakPicker {
  readonly bin: Int32Array;
  /** Interpolated frequency, Hz. */
  readonly hz: Float64Array;
  /** Interpolated level, dBFS. */
  readonly db: Float64Array;
  /**
   * The loudest peaks of `bins` (dBFS, bin k at k × `binHz`) up to `maxHz`:
   * how many it found, from 0 (silence, or nothing above the floor) to `count`.
   */
  pick(bins: Float32Array, binHz: number, maxHz: number): number;
}

export function createPeakPicker(table: PeakTable = SCOPE_PEAKS): PeakPicker {
  const bin = new Int32Array(table.count);
  const hz = new Float64Array(table.count);
  const db = new Float64Array(table.count);
  const ratio = 2 ** (table.semitones / SEMITONES_PER_OCTAVE);

  /** Whether bin `k` is a shoulder of one of the first `n` peaks. */
  const nearPeak = (k: number, n: number): boolean => {
    for (let i = 0; i < n; i++) {
      const j = bin[i]!;
      if (Math.abs(k - j) <= table.minBins || Math.max(k, j) < ratio * Math.min(k, j)) return true;
    }
    return false;
  };

  /** The loudest local maximum in bins `lo..hi` above the floor and clear of the first `n` peaks, or −1. */
  const loudest = (bins: Float32Array, lo: number, hi: number, n: number): number => {
    let best = -1;
    for (let k = lo; k <= hi; k++) {
      const v = bins[k]!;
      if (!(v > table.floorDb) || !(v > bins[k - 1]!) || !(v >= bins[k + 1]!)) continue;
      if (best >= 0 && v <= bins[best]!) continue;
      if (!nearPeak(k, n)) best = k;
    }
    return best;
  };

  return {
    bin,
    hz,
    db,
    pick(bins, binHz, maxHz) {
      const lo = Math.max(1, Math.ceil(table.minHz / binHz));
      const hi = Math.min(bins.length - 2, Math.floor(maxHz / binHz));
      let n = 0;
      while (n < table.count) {
        const k = loudest(bins, lo, hi, n);
        if (k < 0) break;
        const a = bins[k - 1]!;
        const b = bins[k]!;
        const c = bins[k + 1]!;
        const offset = vertexOffset(a, b, c);
        bin[n] = k;
        hz[n] = (k + offset) * binHz;
        db[n] = vertexValue(a, b, c, offset);
        n++;
      }
      return n;
    },
  };
}

/** The nearest MIDI note to `hz`. */
export const nearestNote = (hz: number, tuning = SCOPE_TUNING): number =>
  Math.round(tuning.a4Midi + SEMITONES_PER_OCTAVE * Math.log2(hz / tuning.a4Hz));

/** A peak's label: `195.9 Hz G3`. */
export const peakLabel = (hz: number): string => `${hz.toFixed(1)} Hz ${noteName(nearestNote(hz))}`;
