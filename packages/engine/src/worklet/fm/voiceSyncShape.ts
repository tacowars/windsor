/**
 * The direct shape of a synced Saw, Square or Pulse (windsor#655, record
 * `2026-10-09-sync-direct-shape`): an operator that nothing modulates
 * computes its wave from its phase instead of reading its table, and every
 * edge it makes, its own wraps and duty edges and the reset's step, takes a
 * two-point polyBLEP. Candidate A of the study
 * (`docs/research/2026-10-09-sync-antialias-study/`, `directBundle.mjs`).
 *
 * **Who takes it.** At the bind (`syncShapeKind`): a synced Saw or Square
 * (a table wave) or Pulse with no modulator edge into it in the algorithm,
 * whatever that modulator's level, in a patch whose Tone is 1. Each render
 * call, so at least each control block (`beginSyncShapeBlock`): of those,
 * the ones whose live feedback is exactly 0 across the block, whose phase
 * increment is above 0 and below Nyquist (`SYNC_SHAPE_MAX_INC`; the edge
 * walk only moves forward, so a negative `fixedHz` reads its table,
 * windsor#656) and, for the Saw and Square, whose live width is exactly 1
 * and not ramping. One that
 * stops qualifying reads its table from that block on, and comes back when
 * it qualifies again. An eligible operator sends its wave a sample late on
 * either path, so a switch neither skips nor repeats a sample; one leaving
 * the shape drops the second half of an edge's correction, which its
 * band-limited table already has. One coming back on a sample whose reset
 * fell in the interval before it takes that reset's correction, both
 * halves, which the table path never computed (windsor#656): the reset's
 * `d` and the free-running phase before it are kept for an eligible
 * operator on its table while the reset is the last sample's
 * (`applySyncResets`, `dropSyncShapePending`).
 *
 * **The shape**, in Windsor's polarity at the table's level: `g` is the
 * fundamental of the operator's current table (`refreshGain`, read when the
 * table changes), so the level follows the mip as the table's does.
 *   - Saw: `g·π/2·(1 − 2p)`, a falling ramp that rises `g·π` at phase 0.
 *   - Square: `±g·π/4`, rising `g·π/2` at phase 0 and falling at 0.5.
 *   - Pulse: `saw(p) − saw(p + w)`, `g·π·w` up to phase `1 − w` and
 *     `g·π·(w − 1)` after; it rises `g·π` at 0 and falls at `1 − w`.
 *
 * **The edges**, after each sample's resets (`syncShapeEdges`), between the
 * sample just read and the next, in time order: the wraps and duty edges on
 * the free-running path up to the reset (the whole interval when there is
 * none), then the reset's step, from the left limit at the free-running
 * phase just before it to the wave at phase 0, then a duty edge after it.
 * A Pulse's duty edge moves with its width's ramp across the interval, and
 * is met where the phase meets it, from either side.
 * An edge of step `h` falling `dd` of a sample before the next sample adds
 * `h·dd²/2` to the sample held and owes `h·(1 − dd)²/2` off the next, the
 * same two-sample kernel as the corrected waves' (`SYNC_BLEP_GAIN`); edges
 * in one interval sum.
 *
 * Invariant: a voice with no eligible operator never calls this module, and
 * an unsynced voice takes the kernel. Allocation free; no double crosses a
 * call: every value is the voice's or this state's arrays. The direct
 * operator's phase modulation is 0 by construction (no modulator, no
 * feedback), so the phase it reads is its accumulator's. `voiceSyncShape.test.ts`
 * pins the shape, the edges and the gain; `synth/fmProcessorSyncShape.test.ts`
 * the render.
 */

import type { Patch } from '../../patch/patch';
import type { Voice } from './voice';
import { ALGORITHMS } from './algorithms';
import { SYNC_BLEP_GAIN, SYNC_SHAPE_MAX_INC, TABLE_SIZE } from './fmConstants';
import { OPERATOR_COUNT } from './patchDefaults';
import { WAVE } from './waveIds';
import { KIND_PULSE, KIND_TABLE, SIN_TAB } from './waveTables';

/** The three shapes, by `SyncShape.kind`; `SHAPE_NONE` for an operator that never takes one. */
const SHAPE_NONE = -1,
  SHAPE_SAW = 0,
  SHAPE_SQUARE = 1,
  SHAPE_PULSE = 2;

const HALF_PI = Math.PI / 2;
const SQUARE_DUTY = 1 / 2;

/** One voice's direct-shape state, held by its `VoiceSync`. */
class SyncShape {
  /** A bit per operator the bind lets take the shape. */
  eligible: number;
  /** A bit per eligible operator taking the shape this block. */
  direct: number;
  /** Each eligible operator's shape. */
  kind: Int32Array;
  /** Each direct operator's level: its table's fundamental. */
  gain: Float64Array;
  /** The table each `gain` was read from. */
  table: (Float32Array | null)[];
  /** Each direct operator's phase at the sample just read, and its wave at the next sample's phase. */
  prev: Float64Array;
  next: Float64Array;
  /** Each direct operator's width at the sample just read, where a Pulse's duty ramp across the interval starts. */
  width: Float64Array;
  /**
   * Where this sample's reset fell, `d` of a sample before the next; NaN for
   * none. For an eligible operator on its table, the last sample's reset,
   * which a return to the shape at the next call takes (windsor#656).
   */
  reset: Float64Array;
  /** An eligible operator on its table: the free-running phase just before its last sample's reset. */
  left: Float64Array;

  constructor() {
    this.eligible = 0;
    this.direct = 0;
    this.kind = new Int32Array(OPERATOR_COUNT).fill(SHAPE_NONE);
    // Rule 7: each double array is born with NaN, before its start value.
    this.gain = new Float64Array(OPERATOR_COUNT).fill(NaN);
    this.table = [null, null, null, null];
    this.prev = new Float64Array(OPERATOR_COUNT).fill(NaN);
    this.next = new Float64Array(OPERATOR_COUNT).fill(NaN);
    this.width = new Float64Array(OPERATOR_COUNT).fill(NaN);
    this.reset = new Float64Array(OPERATOR_COUNT).fill(NaN);
    this.left = new Float64Array(OPERATOR_COUNT).fill(NaN);
    this.gain.fill(0);
    this.left.fill(0);
    this.prev.fill(0);
    this.next.fill(0);
    this.width.fill(1);
  }

  /** A note from rest: every eligible operator enters the shape afresh at its first block. */
  start(): void {
    this.direct = 0;
    this.reset.fill(NaN);
  }
}

/**
 * Operator `i`'s shape when the bind lets it take one, else `SHAPE_NONE`:
 * a synced Saw, Square or Pulse with no modulator edge into it in the
 * algorithm, a silent one included, in a patch whose Tone is 1. The caller
 * tests that it is synced. Never in a render.
 */
function syncShapeKind(voice: Voice, patch: Patch, i: number): number {
  const alg = ALGORITHMS[patch.algorithm] ?? ALGORITHMS[0]!;
  if (alg.mods[i]!.length !== 0 || patch.tone !== 1) return SHAPE_NONE;
  const kind = voice.kind[i];
  if (kind === KIND_PULSE) return SHAPE_PULSE;
  if (kind !== KIND_TABLE) return SHAPE_NONE;
  const wave = patch.ops[i]!.wave;
  return wave === WAVE.SAW ? SHAPE_SAW : wave === WAVE.SQUARE ? SHAPE_SQUARE : SHAPE_NONE;
}

/**
 * Operator `i`'s level, its table's fundamental, when its table changed:
 * the table is the Fourier series over its own peak, so its fundamental is
 * `1 / peak`. Read from `TABLE_SIZE` points at the table's own stride (a
 * table holds at most `TABLE_SIZE / 2` harmonics, so none folds onto the
 * fundamental), then kept until the mip changes.
 */
function refreshGain(sh: SyncShape, t: Float32Array, i: number): void {
  if (sh.table[i] === t) return;
  sh.table[i] = t;
  const stride = (t.length - 1) / TABLE_SIZE;
  let acc = 0;
  for (let k = 0; k < TABLE_SIZE; k++) acc += t[k * stride] * SIN_TAB[k];
  sh.gain[i] = (2 * acc) / TABLE_SIZE;
}

/** Operator `i`'s wave at its phase and width now, into `next`, and the phase and width into `prev` and `width`. */
function readNext(voice: Voice, sh: SyncShape, i: number): void {
  let p = voice.phase[i];
  p -= Math.floor(p);
  sh.prev[i] = p;
  sh.width[i] = voice.width[i];
  const g = sh.gain[i];
  const k = sh.kind[i];
  if (k === SHAPE_SAW) sh.next[i] = g * HALF_PI * (1 - 2 * p);
  else if (k === SHAPE_SQUARE)
    sh.next[i] = p < SQUARE_DUTY ? g * HALF_PI * SQUARE_DUTY : -g * HALF_PI * SQUARE_DUTY;
  else {
    const w = voice.width[i];
    sh.next[i] = p < 1 - w ? g * Math.PI * w : g * Math.PI * (w - 1);
  }
}

/**
 * The correction of a reset an operator took on its table in the interval
 * just before it returns to the shape (windsor#656): the step from the left
 * limit at the free-running phase before it (`left`) to the wave at phase 0,
 * the direct path's own reset step, its two halves on the wave held and owed
 * off the next, so the sample it sends back is the shape's. A Pulse's duty
 * is its width now. Allocates nothing.
 */
function carrySyncShapeReset(voice: Voice, sh: SyncShape, i: number): void {
  const d = sh.reset[i];
  const g = sh.gain[i];
  const k = sh.kind[i];
  let x = sh.left[i];
  x -= Math.floor(x);
  if (x === 0) x = 1;
  const duty = k === SHAPE_SQUARE ? SQUARE_DUTY : 1 - voice.width[i];
  const jump = k === SHAPE_SQUARE ? g * HALF_PI : g * Math.PI;
  const h = k === SHAPE_SAW ? g * Math.PI * x : x <= duty || duty === 0 ? 0 : jump;
  const e = 1 - d;
  voice.sync.held[i] += h * d * d * SYNC_BLEP_GAIN;
  voice.sync.after[i] += h * e * e * SYNC_BLEP_GAIN;
}

/**
 * The block's direct operators, at a render call's start, after the
 * control update: each eligible one whose feedback is exactly 0 across the
 * block (`fbTo` 0 and not ramping), whose phase increment is above 0 and
 * below `SYNC_SHAPE_MAX_INC` (the edge walk moves forward only), and, unless
 * it is a Pulse, that is not `squeezed` (the render's bits: width exactly 1,
 * not ramping). One leaving the shape drops what the next sample owes; one
 * entering takes the correction of a reset in the interval before it
 * (`carrySyncShapeReset`) and starts with none pending. Each direct
 * operator's level follows its table, and its next wave is read at its phase
 * and width now. Allocates nothing.
 */
function beginSyncShapeBlock(voice: Voice, squeezed: number): void {
  const sh = voice.sync.shape;
  const fbTo = voice.fbTo;
  let direct = 0;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const bit = 1 << i;
    if ((sh.eligible & bit) === 0 || fbTo[i] !== 0 || (voice.fbRamp & bit) !== 0) continue;
    // Past Nyquist the edge loops would run once a crossed cycle, and the
    // walk only moves forward, so a negative increment would cross its wraps
    // uncorrected: the table for either (windsor#656).
    const inc = voice.phaseInc[i];
    if (!(inc > 0 && inc < SYNC_SHAPE_MAX_INC)) continue;
    if (sh.kind[i] !== SHAPE_PULSE && (squeezed & bit) !== 0) continue;
    direct |= bit;
  }
  const after = voice.sync.after;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const bit = 1 << i;
    if ((sh.direct & bit) !== 0 && (direct & bit) === 0) after[i] = 0;
    if ((direct & bit) === 0) continue;
    refreshGain(sh, voice.tables[i]!, i);
    if ((sh.direct & bit) === 0) {
      if (sh.reset[i] === sh.reset[i]) carrySyncShapeReset(voice, sh, i);
      sh.reset[i] = NaN;
    }
    readNext(voice, sh, i);
  }
  sh.direct = direct;
}

/**
 * Every direct operator's edges between the sample just read and the next,
 * after this sample's resets, then its next wave. Called by the generic
 * loop on every sample while an operator takes the shape. Each edge of step
 * `h`, `dd` of a sample before the next, adds `h·dd²/2` to the held wave
 * and owes `h·(1 − dd)²/2` off the next; they sum. The polyBLEP is written
 * out at each edge, so no double crosses a call (windsor#233). Allocates
 * nothing.
 *
 * A Pulse's width may ramp, so its duty edge moves across the interval: the
 * duty runs linearly from `1 − width` at the sample just read (`sh.width`)
 * to `1 − width` now, `slope` a sample, and the phase meets the edge that
 * stood at `x` at the interval's start at `t = (x − p0) / (inc − slope)`.
 * While the phase outruns the edge it falls there by the shape's jump;
 * while the edge outruns the phase (a fast ramp on a low note) the phase
 * crosses back over it and rises by the same jump. The reset's step reads
 * the duty at the reset's instant, and the edge after it the ramp's rest.
 * A Square's duty and a still width's stand: `slope` is 0, and the search
 * is the fixed-duty one to the bit.
 */
// eslint-disable-next-line max-lines-per-function -- one interval's edges in time order: wraps and duty edges, the reset, the edge after it
function syncShapeEdges(voice: Voice): void {
  const sh = voice.sync.shape;
  const direct = sh.direct;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    if ((direct & (1 << i)) === 0) continue;
    const inc = voice.phaseInc[i];
    const p0 = sh.prev[i];
    const g = sh.gain[i];
    const k = sh.kind[i];
    const d = sh.reset[i];
    const isReset = d === d;
    // The share of the interval the free-running path runs, and the phase it
    // reaches there: the reset's, or the next sample's.
    const span = isReset ? 1 - d : 1;
    const end = p0 + span * inc;
    const duty = k === SHAPE_SAW ? -1 : k === SHAPE_SQUARE ? SQUARE_DUTY : 1 - sh.width[i];
    const slope = k === SHAPE_PULSE ? sh.width[i] - voice.width[i] : 0;
    // How fast the phase gains on the duty edge, and the bound, in the
    // edge's phase at the interval's start, of the edges it meets by `end`.
    const rate = inc - slope;
    const edgeEnd = end - span * slope;
    const jump = k === SHAPE_SQUARE ? g * HALF_PI : g * Math.PI;
    let hold = 0;
    let owe = 0;
    // An edge at the reset instant is the reset's own step, so the loops stop short of it.
    // `beginSyncShapeBlock` keeps |inc| below half a cycle a sample, so each
    // loop below crosses at most one wrap and one duty edge a sample.
    for (let x = Math.floor(p0) + 1; isReset ? x < end : x <= end; x++) {
      const dd = 1 - (x - p0) / inc;
      const e = 1 - dd;
      hold += jump * dd * dd;
      owe += jump * e * e;
    }
    if (duty >= 0 && rate > 0) {
      for (let x = Math.floor(p0 - duty) + 1 + duty; isReset ? x < edgeEnd : x <= edgeEnd; x++) {
        const dd = 1 - (x - p0) / rate;
        const e = 1 - dd;
        hold -= jump * dd * dd;
        owe -= jump * e * e;
      }
    } else if (duty >= 0 && rate < 0) {
      // The edge at or behind the phase overtakes it, and any behind that by the end.
      for (let x = Math.floor(p0 - duty) + duty; x > edgeEnd; x--) {
        const dd = 1 - (x - p0) / rate;
        const e = 1 - dd;
        hold += jump * dd * dd;
        owe += jump * e * e;
      }
    }
    if (isReset) {
      // From the left limit at the free-running phase (1 at a wrap) to the
      // wave at phase 0, at the reset instant's duty. A Pulse at duty 0 is
      // silent, so its reset steps by 0.
      const dutyAt = duty + span * slope;
      let x = end - Math.floor(end);
      if (x === 0) x = 1;
      const h = k === SHAPE_SAW ? g * Math.PI * x : x <= dutyAt || dutyAt === 0 ? 0 : jump;
      const e = 1 - d;
      hold += h * d * d;
      owe += h * e * e;
      // A duty edge after phase 0 and by the next sample: the phase meets
      // it, or, from duty 0, the edge outruns the phase at once.
      if (dutyAt > 0 && dutyAt <= d * rate) {
        const dd = d - dutyAt / rate;
        const f = 1 - dd;
        hold -= jump * dd * dd;
        owe -= jump * f * f;
      } else if (dutyAt === 0 && rate < 0) {
        hold += jump * d * d;
        owe += jump * e * e;
      }
      sh.reset[i] = NaN;
    }
    voice.sync.held[i] += hold * SYNC_BLEP_GAIN;
    voice.sync.after[i] += owe * SYNC_BLEP_GAIN;
    readNext(voice, sh, i);
  }
}

/**
 * After a render call whose last sample took no reset: an eligible operator
 * on its table drops the reset it kept, which is no longer the interval
 * before the next call's first sample (windsor#656). Allocates nothing.
 */
function dropSyncShapePending(voice: Voice): void {
  const sh = voice.sync.shape;
  const table = sh.eligible & ~sh.direct;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    if ((table & (1 << i)) !== 0) sh.reset[i] = NaN;
  }
}

export {
  SHAPE_NONE,
  SHAPE_PULSE,
  SHAPE_SAW,
  SHAPE_SQUARE,
  SyncShape,
  beginSyncShapeBlock,
  dropSyncShapePending,
  syncShapeEdges,
  syncShapeKind,
};
