/**
 * The plate's tank modulation (windsor#764), the block-rate half. All four
 * tank all-passes (lines 4, 6, 8 and 10, `MOD_LINES`) are read at a moving
 * excursion, each driven by a source of its own: smoothed noise, a value that
 * glides from one drawn knot to the next along `3a² − 2a³` (zero slope at each
 * knot), the knots alternating between the upper and the lower half of the
 * range so every one turns the point round, each segment lasting a drawn
 * `MOD_WIDTH_MIN` to `MOD_WIDTH_MIN + 1` half-periods. So `modRate` is the
 * source's average rate in Hz and the point never repeats audibly, and
 * `modDepth` in ms is each point's peak excursion: the read moves from its
 * line's length to `modDepth` shorter, never longer, so it never needs room
 * past the line.
 *
 * The draws are `fm/prng.ts`'s seeded generator at one fixed seed per point
 * (`MOD_SEEDS`), drawn once at load into `MOD_DRAWS`, which every plate shares
 * and reads through cursors of its own: `resetModulation` puts every cursor
 * and source back where a new plate starts, at construction and on the way
 * to sleep, so a woken plate renders as a fresh one, and the same input and
 * parameters always render the same samples. The generator is a closure, so
 * restarting it would allocate on the audio thread; a cursor resets in place.
 *
 * `configureModulation` runs once a block, after `_applySize` has aimed the
 * lengths: the speed, and each point's depth in samples, clamped against the
 * shortest its own line reaches in the block (`MIN_LENGTH` short of it) and
 * ramped across the block from where the last block ended, so a depth or
 * Size sweep moves the reads in sub-sample steps. The source itself, the
 * knots and the excursions are written out in the tank's sample loop
 * (`tank.ts`), never called per sample (worklet rule 6), with no `Math`
 * transcendental: the golden must give the same bits on arm64 and x64.
 *
 * It also leaves each moving all-pass's excursion in `_modExcursion`, and
 * `tankGains.ts` cuts that line's gain point for its length less it: a read
 * moved shorter keeps a sample there for less time, so its gain must lose
 * less, and a deep setting keeps its Decay (at 4 ms, Decay 60 s and Size 0.25
 * the tail ran 11 % short without it). While the sources move, it is their
 * mean, `MOD_MEAN` of the depth, which holds still while the knobs do, so
 * the gains stay put and the tank does not ramp them every sample; at rest,
 * at `modRate` 0, it is where each source rests, read once a block with the
 * same smoothstep the loop writes out.
 *
 * Invariants: nothing allocated after load and construction, no double
 * across a call (worklet rule 2), and at `modDepth` 0 every excursion is
 * exactly 0. `mixer/reverbModulation.test.ts` holds the spread, the held
 * tone, the live moves, the rates and the determinism;
 * `mixer/reverbGolden.test.ts` pins the render.
 */

import { makeRandom } from '../fm/prng';
import { FIRST_TANK_LINE, MIN_LENGTH, TANK_DELAYS } from './reverbConstants';
import {
  MOD_DRAW_LENGTH,
  MOD_HALF,
  MOD_LINES,
  MOD_MEAN,
  MOD_SEEDS,
  MOD_WIDTH_MIN,
} from './reverbModulationTables';
import type { DattorroReverb } from './reverbProcessor';

/** Samples a quantum: each depth ramp crosses one. */
const QUANTUM = 128;
/** Milliseconds a second: `modDepth` is in ms. */
const MS = 1000;
/** Half-periods a cycle: `modRate` cycles a second are twice as many segments. */
const SEGMENTS_PER_CYCLE = 2;
/** Draws a segment takes: its knot, then its width. */
const DRAWS_PER_SEGMENT = 2;
/** The smoothstep 3a² − 2a³ written as a² (3 − 2a), as the tank's loop writes it. */
const SMOOTHSTEP = 3;

/**
 * Every point's draws, laid end to end (point p's from p × MOD_DRAW_LENGTH),
 * in pairs: a knot's place in its half, then the segment's width. Drawn once,
 * at load, from `fm/prng.ts`'s generator at each point's fixed seed.
 */
const MOD_DRAWS = new Float32Array(MOD_LINES.length * MOD_DRAW_LENGTH);
for (let p = 0; p < MOD_LINES.length; p++) {
  const random = makeRandom(MOD_SEEDS[p]);
  for (let i = 0; i < MOD_DRAW_LENGTH; i++) MOD_DRAWS[p * MOD_DRAW_LENGTH + i] = random();
}

/** The modulation's state, from the processor's constructor (worklet rule 7). */
function makeModulation(plate: DattorroReverb): void {
  const points = MOD_LINES.length;
  plate._modRising = new Int32Array(points);
  plate._modCursor = new Int32Array(points);
  plate._modFrom = new Float64Array(points);
  plate._modSpan = new Float64Array(points);
  plate._modPhase = new Float64Array(points);
  plate._modWidth = new Float64Array(points);
  plate._modDt = new Float64Array(points);
  plate._modOffset = new Float64Array(points);
  plate._modDepth = new Float64Array(points);
  plate._modDepthTarget = new Float64Array(points);
  plate._modDepthStep = new Float64Array(points);
  plate._modExcursion = new Float64Array(TANK_DELAYS.length);
  plate._modSpeed = NaN;
  plate._modSpeed = 0;
  resetModulation(plate);
}

/**
 * Every point back to where a new plate starts, at construction and on the
 * way to sleep: at 0, rising to its first knot over its first width, its
 * cursor past those two draws, and its depth 0, which the next block ramps
 * from.
 */
function resetModulation(plate: DattorroReverb): void {
  for (let p = 0; p < MOD_LINES.length; p++) {
    const first = p * MOD_DRAW_LENGTH;
    plate._modRising[p] = 1;
    plate._modCursor[p] = DRAWS_PER_SEGMENT;
    plate._modFrom[p] = 0;
    plate._modSpan[p] = MOD_HALF + MOD_HALF * MOD_DRAWS[first];
    plate._modPhase[p] = 0;
    plate._modWidth[p] = MOD_WIDTH_MIN + MOD_DRAWS[first + 1];
    plate._modDt[p] = 0;
    plate._modOffset[p] = 0;
    plate._modDepth[p] = 0;
    plate._modDepthTarget[p] = 0;
    plate._modDepthStep[p] = 0;
  }
}

/**
 * This block's speed (segments a sample at width 1) and each point's phase
 * step, and each point's depth in samples: clamped against the shortest its
 * own line reaches in the block, and ramped across it from the last block's
 * target, on which the last ramp lands exactly; and each moving line's
 * excursion at that target depth, for its gain point: its mean while the
 * sources move, where it rests while they do not.
 */
function configureModulation(
  plate: DattorroReverb,
  parameters: Record<string, Float32Array>,
): void {
  plate._modSpeed = (SEGMENTS_PER_CYCLE * parameters.modRate[0]) / sampleRate;
  const asked = (parameters.modDepth[0] * sampleRate) / MS;
  const length = plate._length;
  const lengthTarget = plate._lengthTarget;
  for (let p = 0; p < MOD_LINES.length; p++) {
    const line = MOD_LINES[p];
    const shortest = Math.min(length[line], lengthTarget[line]);
    plate._modDt[p] = plate._modSpeed / plate._modWidth[p];
    plate._modDepth[p] = plate._modDepthTarget[p];
    plate._modDepthTarget[p] = Math.max(0, Math.min(asked, shortest - MIN_LENGTH));
    plate._modDepthStep[p] = (plate._modDepthTarget[p] - plate._modDepth[p]) / QUANTUM;
    const a = plate._modPhase[p];
    const place =
      plate._modSpeed > 0
        ? MOD_MEAN
        : plate._modFrom[p] + plate._modSpan[p] * a * a * (SMOOTHSTEP - 2 * a);
    plate._modExcursion[line - FIRST_TANK_LINE] = plate._modDepthTarget[p] * place;
  }
}

export { MOD_DRAWS, configureModulation, makeModulation, resetModulation };
