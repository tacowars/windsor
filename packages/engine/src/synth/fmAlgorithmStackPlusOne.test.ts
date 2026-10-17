/**
 * Algorithm 11, Stack + One (`D>C>B | A`, windsor#895): D modulates C, C
 * modulates B, and B and A are summed to the output. Each operator is
 * silenced in turn and the render compared, to the bit, with an older
 * two-carrier algorithm that routes what is left the same way, in both the
 * kernel and the generic loop: two carriers commute exactly. The voice scales
 * its carrier sum by 1/√(carriers), so against Stack + Two's three carriers
 * the render is the same signal at √(3/2) times the level, held to
 * `GAIN_TOLERANCE` rather than the bit.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import { makePatch, WAVE } from '../patch/patch';
import type { PartialPatch } from '../patch/patch';

const loaded = loadProcessor();
const BLOCK_FRAMES = 128;
const HOLD_BLOCKS = 120;
const TAIL_BLOCKS = 60;
const NOTES: ScheduledEvent[] = [
  { type: 'noteOn', id: 1, note: 45, velocity: 0.9, frame: 0 },
  { type: 'noteOn', id: 2, note: 64, velocity: 0.5, frame: 37 },
  { type: 'noteOff', id: 1, frame: HOLD_BLOCKS * BLOCK_FRAMES + 5 },
  { type: 'noteOff', id: 2, frame: HOLD_BLOCKS * BLOCK_FRAMES + 70 },
];

type Ops = NonNullable<PartialPatch['ops']>;
/**
 * Four sines at distinct ratios and levels, so every operator is told apart,
 * each starting at a fixed phase: a free phase is drawn in operator order, so
 * operators moved to other slots would start elsewhere.
 */
const OPS: Ops = [
  { wave: WAVE.SINE, ratio: 1, level: 0.9, phaseFree: false, phase: 0.1 },
  { wave: WAVE.SINE, ratio: 2, level: 0.8, phaseFree: false, phase: 0.3 },
  { wave: WAVE.SINE, ratio: 3.5, level: 0.7, phaseFree: false, phase: 0.6 },
  { wave: WAVE.SINE, ratio: 1.41, level: 0.6, phaseFree: false, phase: 0.85 },
];
const A = 0,
  B = 1,
  C = 2,
  D = 3;

/** `ops` with each operator in `silent` at level 0, and `extra` merged into every one. */
function opsWith(silent: number[], extra: object = {}, ops: Ops = OPS): Ops {
  return ops.map((op, i) => ({ ...op, ...extra, ...(silent.includes(i) ? { level: 0 } : {}) }));
}

function renderPatch(algorithm: number, ops: Ops, specialise: boolean): Float32Array {
  const processor = loaded.create(makePatch({ algorithm, ops }), 8, undefined, { specialise });
  return render(loaded, processor, HOLD_BLOCKS + TAIL_BLOCKS, NOTES).samples;
}

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;

/** Float32 rounding of the two gains, relative to the render's peak. */
const GAIN_TOLERANCE = 1e-6;

/** The largest gap between `a` and `b` scaled by `k`, over `a`'s peak. */
function scaledGap(a: Float32Array, b: Float32Array, k: number): number {
  let gap = 0;
  let peak = 0;
  for (let i = 0; i < a.length; i++) {
    gap = Math.max(gap, Math.abs(a[i]! - k * b[i]!));
    peak = Math.max(peak, Math.abs(a[i]!));
  }
  return gap / peak;
}

const PATHS: [string, boolean][] = [
  ['the kernel', true],
  ['the generic loop', false],
];

describe('Stack + One in the kernel (windsor#895)', () => {
  it('takes the kernel and renders bit-identical to the generic loop, feedback on every operator', () => {
    const ops = OPS.map((op, i) => ({ ...op, feedback: [0.5, -0.4, 0.7, 0.9][i]! }));
    const processor = loaded.create(makePatch({ algorithm: 11, ops }), 8);
    render(loaded, processor, 1, NOTES.slice(0, 1));
    const voices = processor.voices as unknown as { active: boolean; kernel: boolean }[];
    expect(voices.find((v) => v.active)?.kernel).toBe(true);
    const kernel = renderPatch(11, ops, true);
    expect(kernel.some((s) => s !== 0)).toBe(true);
    expect(sameBits(kernel, renderPatch(11, ops, false))).toBe(true);
  });
});

describe.each(PATHS)('Stack + One through %s (windsor#895)', (_path, specialise) => {
  const stackPlusOne = (ops: Ops): Float32Array => renderPatch(11, ops, specialise);
  const other = (algorithm: number, ops: Ops): Float32Array =>
    renderPatch(algorithm, ops, specialise);

  it('hears every operator: silencing any one changes the render', () => {
    const all = stackPlusOne(OPS);
    expect(all.some((s) => s !== 0)).toBe(true);
    for (const op of [A, B, C, D]) {
      expect(sameBits(stackPlusOne(opsWith([op])), all), `operator ${op}`).toBe(false);
    }
  });

  it('with A at 0, is the D>C>B stack alone: Series + Tap with A at 0', () => {
    expect(sameBits(stackPlusOne(opsWith([A])), other(8, opsWith([A])))).toBe(true);
  });

  it('with B at 0, is A alone and unmodulated: Split Branch with B and C at 0', () => {
    expect(sameBits(stackPlusOne(opsWith([B])), other(9, opsWith([B, C])))).toBe(true);
  });

  it('with C at 0, is A and B as plain sines: Split Branch with C at 0', () => {
    expect(sameBits(stackPlusOne(opsWith([C])), other(9, opsWith([C])))).toBe(true);
  });

  it('with D and C at 0, is Stack + Two with D and C at 0, at its two-carrier gain', () => {
    const heard = stackPlusOne(opsWith([C, D]));
    expect(sameBits(heard, other(9, opsWith([C, D])))).toBe(true);
    const gap = scaledGap(heard, other(6, opsWith([C, D])), Math.sqrt(3) / Math.sqrt(2));
    expect(gap).toBeLessThan(GAIN_TOLERANCE);
  });

  it('with D at 0, is C into B beside A: Two Stacks with the operators moved to match', () => {
    // Two Stacks is D>C | B>A, heard A then C: its B>A is our C>B, its C is our A.
    const [a, b, c] = opsWith([D]);
    const moved: Ops = [b!, c!, a!, { ...OPS[D], level: 0 }];
    expect(sameBits(stackPlusOne(opsWith([D])), other(4, moved))).toBe(true);
  });

  it('feeds D back on itself as Series + Tap does', () => {
    const fbD = opsWith([A]).map((op, i) => (i === D ? { ...op, feedback: 0.8 } : op));
    const heard = stackPlusOne(fbD);
    expect(sameBits(heard, stackPlusOne(opsWith([A])))).toBe(false);
    expect(sameBits(heard, other(8, fbD))).toBe(true);
  });

  it('feeds A back on itself as Split Branch does', () => {
    const fbA = opsWith([B]).map((op, i) => (i === A ? { ...op, feedback: -0.6 } : op));
    const heard = stackPlusOne(fbA);
    expect(sameBits(heard, stackPlusOne(opsWith([B])))).toBe(false);
    expect(sameBits(heard, other(9, opsWith([C], {}, fbA)))).toBe(true);
  });
});
