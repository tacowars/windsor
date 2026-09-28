/**
 * The LFO's per-operator routes (windsor#10): the "To A / To B / To C / To D"
 * knobs, `lfo.toOp[0..3]`. `voiceControl.ts` scales each operator's target
 * amplitude by
 *
 *     lfoAmp = 1 + lfoVal × toOp[i], clamped at 0
 *
 * so a route moves a carrier's level and a modulator's index. Driven here
 * through the shipped bundle (`__fixtures__/workletHarness.ts`) with a slow
 * retriggered square LFO at amount 1: +1 for the first half cycle, -1 for
 * the second, so each half is a steady window whose level or spectrum the
 * test reads. No DSP is touched.
 */
import { describe, expect, it } from 'vitest';

import type { Patch } from '../patch/patch';
import { LFO_SHAPE, makeEnvelope, makePatch } from '../patch/patch';
import type { LoadedProcessor } from './workletHarness';
import { goertzel, loadProcessor, render } from './workletHarness';

const loaded: LoadedProcessor = loadProcessor();

/** A4, whose period divides 4800 frames into exactly 44 cycles, so Goertzel reads it without leakage. */
const NOTE = 69;
const FUNDAMENTAL = 440;
/** 4 Hz: the square is +1 for frames [0, ~6000) and -1 for [~6000, 12000). */
const LFO_RATE = 4;
/** Two windows of 4800 frames, one inside each half cycle, clear of the attack and the flip. */
const HIGH: [number, number] = [600, 5400];
const LOW: [number, number] = [6600, 11400];
const BLOCKS = Math.ceil(12000 / 128);
/** Held flat: an instant attack to a sustain of 1, no velocity or key scaling. */
const FLAT_ENV = makeEnvelope({ attackTime: 0.001, peakLevel: 1, sustainLevel: 1 });
const ALG_SERIES = 0;
const ALG_ADDITIVE = 7;
/** Below this a window is silence: the voice's floor, far under any audible level. */
const SILENCE = 1e-6;

type Depths = [number, number, number, number];

/** A patch with operator levels `levels` under `algorithm`, a flat envelope and the square LFO. */
function routed(algorithm: number, levels: Depths, toOp: Depths): Patch {
  return makePatch({
    algorithm,
    ops: levels.map((level) => ({ level, velSens: 0, env: FLAT_ENV })),
    lfo: {
      shape: LFO_SHAPE.SQUARE,
      rate: LFO_RATE,
      amount: 1,
      delay: 0,
      retrigger: true,
      modWheelDepth: 0,
      toOp,
    },
  });
}

/** One held note from frame 0, interleaved stereo as the harness keeps it. */
function hold(patch: Patch): Float32Array {
  const processor = loaded.create(patch, 1);
  const events = [{ type: 'noteOn' as const, id: 1, note: NOTE, velocity: 1, frame: 0 }];
  return render(loaded, processor, BLOCKS, events).samples;
}

function windowOf(samples: Float32Array, [start, end]: [number, number]): Float32Array {
  return samples.subarray(start * 2, end * 2);
}

function rms(samples: Float32Array, span: [number, number]): number {
  const w = windowOf(samples, span);
  let energy = 0;
  for (let i = 0; i < w.length; i += 2) energy += (w[i] ?? 0) ** 2;
  return Math.sqrt(energy / (w.length / 2));
}

/** The level in each half cycle of the LFO. */
function halves(samples: Float32Array): { high: number; low: number } {
  return { high: rms(samples, HIGH), low: rms(samples, LOW) };
}

/** Second-harmonic energy over the fundamental's: 0 for a pure sine, rising with the index. */
function brightness(samples: Float32Array, span: [number, number]): number {
  const w = windowOf(samples, span);
  const sr = loaded.sampleRate;
  return goertzel(w, 2 * FUNDAMENTAL, sr) / goertzel(w, FUNDAMENTAL, sr);
}

const onlyOp = (i: number, value: number, rest = 0): Depths =>
  [0, 1, 2, 3].map((j) => (j === i ? value : rest)) as Depths;

const OPS = ['A', 'B', 'C', 'D'];

describe.each(OPS.map((name, i) => ({ name, i })))('the LFO route to $name', ({ i }) => {
  // Additive: every operator is a carrier, and only operator i sounds.
  const levels = onlyOp(i, 1);
  const flat = halves(hold(routed(ALG_ADDITIVE, levels, onlyOp(i, 0))));

  it('sounds the same in both halves at depth 0, whatever the other routes do', () => {
    const others = halves(hold(routed(ALG_ADDITIVE, levels, onlyOp(i, 0, 1))));
    expect(flat.high).toBeGreaterThan(0.01);
    expect(flat.high / flat.low).toBeCloseTo(1, 3);
    expect(others.high / flat.high).toBeCloseTo(1, 3);
    expect(others.low / flat.low).toBeCloseTo(1, 3);
  });

  it('swings its operator by 1 ± depth with the LFO', () => {
    const swung = halves(hold(routed(ALG_ADDITIVE, levels, onlyOp(i, 0.5))));
    expect(swung.high / flat.high).toBeCloseTo(1.5, 2);
    expect(swung.low / flat.low).toBeCloseTo(0.5, 2);
  });

  it('inverts the swing at a negative depth', () => {
    const inverted = halves(hold(routed(ALG_ADDITIVE, levels, onlyOp(i, -0.5))));
    expect(inverted.high / flat.high).toBeCloseTo(0.5, 2);
    expect(inverted.low / flat.low).toBeCloseTo(1.5, 2);
  });

  it('reaches silence at depth -1 with the LFO at +1, and doubles at -1', () => {
    const closed = halves(hold(routed(ALG_ADDITIVE, levels, onlyOp(i, -1))));
    expect(closed.high).toBeLessThan(SILENCE);
    expect(closed.low / flat.low).toBeCloseTo(2, 2);
  });

  it('clamps past -1 to silence rather than flipping the sign', () => {
    // Unclamped, 1 + (+1)(-2) = -1 would play the operator at full level, inverted.
    const past = halves(hold(routed(ALG_ADDITIVE, levels, onlyOp(i, -2))));
    expect(past.high).toBeLessThan(SILENCE);
    expect(past.low / flat.low).toBeCloseTo(3, 2);
  });
});

describe('the LFO route to a modulator', () => {
  // Series D>C>B>A: A is the one carrier, B modulates it, C and D are silent.
  const levels: Depths = [1, 0.5, 0, 0];

  it('moves the modulation index, not the level', () => {
    const samples = hold(routed(ALG_SERIES, levels, [0, 1, 0, 0]));
    const level = halves(samples);
    // At LFO -1, B's amplitude is 0: A plays a pure sine. At +1 it doubles.
    expect(brightness(samples, LOW)).toBeLessThan(1e-3);
    expect(brightness(samples, HIGH)).toBeGreaterThan(0.1);
    // Phase modulation leaves a sine carrier's power where it was.
    expect(level.high / level.low).toBeCloseTo(1, 1);
  });

  it('leaves the spectrum steady at depth 0', () => {
    const samples = hold(routed(ALG_SERIES, levels, [0, 0, 0, 0]));
    expect(brightness(samples, HIGH)).toBeGreaterThan(0.01);
    expect(brightness(samples, HIGH) / brightness(samples, LOW)).toBeCloseTo(1, 3);
  });
});
