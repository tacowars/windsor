/**
 * The Pump's drawn shape on the audio thread (record `2026-10-13-pump-insert`
 * decision 3): the breakpoint params read into per-segment arrays when any
 * of them moves, and the level at a phase evaluated as `pumpLevelAt` does,
 * the same operations in the same order (`inserts/pumpCurves.ts`), with a
 * cursor that walks forward through the segments as the phase grows.
 *
 * Invariants: `load` and `level` allocate nothing; the phase comes in and
 * the level goes out through fields (worklet rule 2); every double field is
 * born NaN (rule 7). Pinned against `pumpLevelAt` by `inserts/pumpDsp.test.ts`.
 */
import { PUMP_MAX_POINTS, PUMP_MIN_POINTS } from '../../inserts/pumpConstants';

type PumpShapeParams = Record<string, Float32Array>;

/** Each slot's param names, built once: a name made on the render path would allocate. */
const PUMP_AT_NAMES = Array.from({ length: PUMP_MAX_POINTS }, (_, i) => `at${i}`);
const PUMP_LEVEL_NAMES = Array.from({ length: PUMP_MAX_POINTS }, (_, i) => `level${i}`);
const PUMP_BEND_NAMES = Array.from({ length: PUMP_MAX_POINTS }, (_, i) => `bend${i}`);
/** The cache's layout: the count, then each slot's at, level and bend. */
const PUMP_SLOT_WIDTH = 3;

class PumpShape {
  readonly starts: Float64Array;
  readonly widths: Float64Array;
  readonly levels: Float64Array;
  readonly spans: Float64Array;
  readonly betas: Float64Array;
  /** The params the arrays were built from, to see a change without rebuilding. */
  readonly seen: Float64Array;
  count: number;
  /** The segment the cursor is on. */
  seg: number;
  lastLevel: number;
  /** In: where in the cycle, below 1. Out: the shape's level there. */
  phase: number;
  value: number;

  constructor(params: PumpShapeParams) {
    this.lastLevel = this.phase = this.value = NaN;
    this.starts = new Float64Array(PUMP_MAX_POINTS);
    this.widths = new Float64Array(PUMP_MAX_POINTS);
    this.levels = new Float64Array(PUMP_MAX_POINTS);
    this.spans = new Float64Array(PUMP_MAX_POINTS);
    this.betas = new Float64Array(PUMP_MAX_POINTS);
    this.seen = new Float64Array(1 + PUMP_SLOT_WIDTH * PUMP_MAX_POINTS).fill(NaN);
    this.count = PUMP_MIN_POINTS;
    this.seg = 0;
    this.lastLevel = 1;
    this.phase = this.value = 0;
    this.load(params);
  }

  /** Read the shape's params; rebuild the segments if any moved. True when they did. */
  load(params: PumpShapeParams): boolean {
    const seen = this.seen;
    let changed = seen[0] !== params.count[0];
    seen[0] = params.count[0];
    for (let i = 0; i < PUMP_MAX_POINTS; i++) {
      const at = params[PUMP_AT_NAMES[i]][0],
        level = params[PUMP_LEVEL_NAMES[i]][0],
        bend = params[PUMP_BEND_NAMES[i]][0];
      const k = 1 + PUMP_SLOT_WIDTH * i;
      if (seen[k] !== at || seen[k + 1] !== level || seen[k + 2] !== bend) changed = true;
      seen[k] = at;
      seen[k + 1] = level;
      seen[k + 2] = bend;
    }
    if (changed) this.build();
    return changed;
  }

  /** The segments from `seen`: positions held in order, the ends at 0 and 1. */
  build(): void {
    const seen = this.seen;
    const raw = Math.round(seen[0]);
    const count =
      raw < PUMP_MIN_POINTS ? PUMP_MIN_POINTS : raw > PUMP_MAX_POINTS ? PUMP_MAX_POINTS : raw;
    this.count = count;
    let previous = 0;
    for (let i = 0; i < count; i++) {
      const k = 1 + PUMP_SLOT_WIDTH * i;
      const at = i === 0 ? 0 : i === count - 1 ? 1 : seen[k];
      const held = at < previous ? previous : at > 1 ? 1 : at;
      this.starts[i] = held;
      this.levels[i] = seen[k + 1];
      // `bendBeta`'s expression, inline: no double crosses a call (worklet rule 2).
      const bend = seen[k + 2];
      this.betas[i] = (1 - bend) / (1 + bend);
      previous = held;
    }
    for (let i = 0; i < count - 1; i++) {
      this.widths[i] = this.starts[i + 1] - this.starts[i];
      this.spans[i] = this.levels[i + 1] - this.levels[i];
    }
    this.lastLevel = this.levels[count - 1];
    this.seg = 0;
  }

  /** The level at `phase` (below 1) into `value`, the cursor walked forward to its segment. */
  level(): void {
    const phase = this.phase;
    const lastSeg = this.count - 2;
    let seg = this.seg;
    while (seg < lastSeg && phase >= this.starts[seg + 1]) seg++;
    this.seg = seg;
    const width = this.widths[seg];
    const u = width > 0 ? (phase - this.starts[seg]) / width : 1;
    const f = u / (u + this.betas[seg] * (1 - u));
    this.value = this.levels[seg] + this.spans[seg] * f;
  }
}

export { PumpShape };
export type { PumpShapeParams };
