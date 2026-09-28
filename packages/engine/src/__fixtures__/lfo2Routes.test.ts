/**
 * The second LFO and the two modes both LFOs gained (windsor#55, record
 * `2026-09-28-operator-width-pulse-and-a-second-lfo`): LFO 2 reaches pitch,
 * level, width and the filter at its own rate; one-shot runs the phase once
 * and holds its end value; unipolar remaps -1..1 to 0..1. Driven through the
 * shipped bundle (`__fixtures__/workletHarness.ts`) with a slow retriggered
 * square or a one-shot, read in steady windows as `lfoRoutes.test.ts` does.
 * No DSP is touched.
 */
import { describe, expect, it } from 'vitest';

import type { LfoSettings, PartialPatch } from '../patch/patch';
import { FILTER_MODE, LFO_SHAPE, makeEnvelope, makePatch, WAVE } from '../patch/patch';
import type { LoadedProcessor, ScheduledEvent } from './workletHarness';
import { goertzel, loadProcessor, render } from './workletHarness';

const loaded: LoadedProcessor = loadProcessor();
const SR = loaded.sampleRate;

/** A4: 4800 frames hold exactly 44 cycles, so Goertzel reads it without leakage. */
const NOTE = 69;
const F0 = 440;
/** 4 Hz: a square is +1 for frames [0, ~6000) and -1 for [~6000, 12000). */
const RATE = 4;
const HIGH: [number, number] = [600, 5400];
const LOW: [number, number] = [6600, 11400];
const BLOCKS = Math.ceil(12000 / 128);
const FLAT_ENV = makeEnvelope({ attackTime: 0.001, peakLevel: 1, sustainLevel: 1 });
const ALG_ADDITIVE = 7;

/** A lone flat sine on A, with LFO 2 set from `lfo2` over a square at RATE, amount 1. */
function withLfo2(lfo2: Partial<LfoSettings>, extra: PartialPatch = {}): PartialPatch {
  return {
    algorithm: ALG_ADDITIVE,
    ops: [{ level: 1, velSens: 0, env: FLAT_ENV }, { level: 0 }, { level: 0 }, { level: 0 }],
    lfo2: { shape: LFO_SHAPE.SQUARE, rate: RATE, amount: 1, retrigger: true, ...lfo2 },
    ...extra,
  };
}

function hold(partial: PartialPatch, blocks = BLOCKS, mod = 0): Float32Array {
  const processor = loaded.create(makePatch(partial), 1);
  const events: ScheduledEvent[] = [
    { type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0, mod },
  ];
  const result = render(loaded, processor, blocks, events);
  expect(result.nonFinite).toBe(0);
  return result.samples;
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

const at = (samples: Float32Array, span: [number, number], hz: number): number =>
  goertzel(windowOf(samples, span), hz, SR);

/** Second-harmonic amplitude over the fundamental's. */
const brightness = (samples: Float32Array, span: [number, number]): number =>
  at(samples, span, 2 * F0) / at(samples, span, F0);

/** The carrier's peak in each ~one-cycle window from `from` on, over the flat render's. */
function envelopeRatios(samples: Float32Array, flat: Float32Array, from: number): number[] {
  const ratios: number[] = [];
  for (let start = from; start + 110 <= samples.length / 2; start += 110) {
    let peak = 0,
      flatPeak = 0;
    for (let i = start; i < start + 110; i++) {
      peak = Math.max(peak, Math.abs(samples[i * 2] ?? 0));
      flatPeak = Math.max(flatPeak, Math.abs(flat[i * 2] ?? 0));
    }
    ratios.push(peak / flatPeak);
  }
  return ratios;
}

const flat = hold(withLfo2({}));

describe('LFO 2 routes', () => {
  it('adds exactly nothing with no depth anywhere: the same bits as a patch without it', () => {
    // `flat` runs LFO 2 as a square at amount 1, routed nowhere.
    const none = hold({
      algorithm: ALG_ADDITIVE,
      ops: [{ level: 1, velSens: 0, env: FLAT_ENV }, { level: 0 }, { level: 0 }, { level: 0 }],
    });
    expect(Buffer.compare(Buffer.from(none.buffer), Buffer.from(flat.buffer))).toBe(0);
  });

  it('swings an operator by 1 ± depth, as LFO 1 does', () => {
    const swung = hold(withLfo2({ toOp: [0.5, 0, 0, 0] }));
    expect(rms(swung, HIGH) / rms(flat, HIGH)).toBeCloseTo(1.5, 2);
    expect(rms(swung, LOW) / rms(flat, LOW)).toBeCloseTo(0.5, 2);
  });

  it('moves the pitch by its toPitch semitones', () => {
    const bent = hold(withLfo2({ toPitch: 12 }));
    expect(at(bent, HIGH, 2 * F0)).toBeGreaterThan(10 * at(bent, HIGH, F0));
    expect(at(bent, LOW, F0 / 2)).toBeGreaterThan(10 * at(bent, LOW, F0));
  });

  it('moves the width: the second harmonic rises and falls with a slow square', () => {
    const squeezed = hold(withLfo2({ toWidth: [-0.5, 0, 0, 0] }));
    // +1: width 0.5, a strong second harmonic; -1: 1.5 clamped to 1, a pure sine.
    expect(brightness(squeezed, HIGH)).toBeGreaterThan(0.5);
    expect(brightness(squeezed, LOW)).toBeLessThan(1e-3);
  });

  it('moves the filter by lfo2Amount octaves', () => {
    const filtered = (lfo2Amount: number): Float32Array =>
      hold(
        withLfo2(
          {},
          {
            ops: [{ level: 1, velSens: 0, env: FLAT_ENV, wave: WAVE.SAW }],
            filter: { mode: FILTER_MODE.LOWPASS, cutoff: 1000, lfo2Amount },
          },
        ),
      );
    const still = filtered(0);
    const swept = filtered(2);
    const fifth = (s: Float32Array, span: [number, number]): number => at(s, span, 5 * F0);
    expect(fifth(still, HIGH) / fifth(still, LOW)).toBeCloseTo(1, 3);
    // Cutoff 4 kHz against 250 Hz: the fifth harmonic, 2.2 kHz, is far louder open.
    expect(fifth(swept, HIGH) / fifth(swept, LOW)).toBeGreaterThan(10);
  });

  it('follows the wheel only as deep as its modWheelDepth, default 0', () => {
    const deaf = hold(withLfo2({ amount: 0, toOp: [0.5, 0, 0, 0] }), BLOCKS, 1);
    expect(rms(deaf, HIGH) / rms(deaf, LOW)).toBeCloseTo(1, 3);
    const wheeled = hold(
      withLfo2({ amount: 0, modWheelDepth: 1, toOp: [0.5, 0, 0, 0] }),
      BLOCKS,
      1,
    );
    expect(rms(wheeled, HIGH) / rms(wheeled, LOW)).toBeCloseTo(3, 1);
  });
});

describe('LFO 2 one-shot and unipolar', () => {
  /** 2 Hz: one period is 24000 frames; the windows after it are the held end. */
  const AFTER: [number, number] = [26400, 31200];
  const LATER: [number, number] = [36000, 40800];
  const LONG = Math.ceil(42000 / 128);
  const oneShot = (unipolar: boolean): Float32Array =>
    hold(
      withLfo2({
        shape: LFO_SHAPE.SAW_DOWN,
        rate: 2,
        oneShot: true,
        unipolar,
        toOp: [0.5, 0, 0, 0],
      }),
      LONG,
    );
  const longFlat = hold(withLfo2({}), LONG);

  it('holds a saw-down at -1 after one period, bipolar', () => {
    const held = oneShot(false);
    expect(rms(held, AFTER) / rms(longFlat, AFTER)).toBeCloseTo(0.5, 2);
    expect(rms(held, LATER) / rms(longFlat, LATER)).toBeCloseTo(0.5, 2);
  });

  it('holds a saw-down at 0 after one period, unipolar', () => {
    const held = oneShot(true);
    expect(rms(held, AFTER) / rms(longFlat, AFTER)).toBeCloseTo(1, 2);
    expect(rms(held, LATER) / rms(longFlat, LATER)).toBeCloseTo(1, 2);
  });

  it('keeps every shape within 0..1 when unipolar', () => {
    const shapes = Object.values(LFO_SHAPE);
    expect(shapes.length).toBeGreaterThanOrEqual(7);
    for (const shape of shapes) {
      // 20 Hz: five periods, so the random shapes draw several values.
      const lfo2 = { shape, rate: 20, toOp: [1, 0, 0, 0] };
      // 1 + v: within [1, 2] for v in [0, 1]; the bipolar LFO dips below 1.
      const uni = envelopeRatios(hold(withLfo2({ ...lfo2, unipolar: true })), flat, 600);
      expect(Math.min(...uni)).toBeGreaterThan(0.99);
      expect(Math.max(...uni)).toBeLessThan(2.01);
      const bi = envelopeRatios(hold(withLfo2(lfo2)), flat, 600);
      expect(Math.min(...bi)).toBeLessThan(0.9);
    }
  });

  it('holds one sample-and-hold value per note', () => {
    const processor = loaded.create(
      makePatch(
        withLfo2({ shape: LFO_SHAPE.SAMPLE_HOLD, rate: 8, oneShot: true, toOp: [0.5, 0, 0, 0] }),
      ),
      1,
    );
    const events: ScheduledEvent[] = [
      { type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 },
      { type: 'noteOff', id: 1, frame: 12000 },
      { type: 'noteOn', id: 2, note: NOTE, velocity: 1, frame: 36000 },
    ];
    const s = render(loaded, processor, Math.ceil(48000 / 128), events).samples;
    // At 8 Hz a free S&H would draw every 6000 frames; one-shot never redraws.
    const first = [rms(s, [600, 5400]), rms(s, [6600, 11400])];
    const second = [rms(s, [36600, 41400]), rms(s, [42600, 47400])];
    expect(first[1]! / first[0]!).toBeCloseTo(1, 3);
    expect(second[1]! / second[0]!).toBeCloseTo(1, 3);
    // A fresh draw at each note-on.
    expect(Math.abs(second[0]! / first[0]! - 1)).toBeGreaterThan(1e-3);
  });

  it('forces a reset at note-on whatever retrigger says', () => {
    // Two notes in turn on the one voice, retrigger off: without the forced
    // reset the second would start where the first ended, held at -1.
    const lfo2 = { shape: LFO_SHAPE.SAW_DOWN, rate: 2, oneShot: true, retrigger: false };
    const processor = loaded.create(makePatch(withLfo2({ ...lfo2, toOp: [0.5, 0, 0, 0] })), 1);
    const events: ScheduledEvent[] = [
      { type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 },
      { type: 'noteOff', id: 1, frame: 26400 },
      { type: 'noteOn', id: 2, note: NOTE, velocity: 1, frame: 48000 },
    ];
    const s = render(loaded, processor, Math.ceil(52000 / 128), events).samples;
    const firstEarly = rms(s, [600, 3000]);
    const firstEnd = rms(s, [24600, 25800]);
    const secondEarly = rms(s, [48600, 51000]);
    expect(firstEarly / firstEnd).toBeGreaterThan(2);
    expect(secondEarly / firstEarly).toBeCloseTo(1, 2);
  });
});

describe('LFO 2 beside LFO 1', () => {
  it('runs at its own rate: LFO 1 on level and LFO 2 on width at once', () => {
    const both = hold(
      withLfo2(
        { toWidth: [-0.5, 0, 0, 0] },
        {
          lfo: {
            shape: LFO_SHAPE.SQUARE,
            rate: 1,
            amount: 1,
            retrigger: true,
            toOp: [0.5, 0, 0, 0],
          },
        },
      ),
    );
    // LFO 1 at 1 Hz holds +1 across both windows; LFO 2 at 4 Hz flips between them.
    // A sine squeezed into half its period keeps half its energy: RMS × √½.
    expect(rms(both, HIGH) / rms(flat, HIGH)).toBeCloseTo(1.5 * Math.SQRT1_2, 2);
    expect(rms(both, LOW) / rms(flat, LOW)).toBeCloseTo(1.5, 2);
    expect(brightness(both, HIGH)).toBeGreaterThan(0.5);
    expect(brightness(both, LOW)).toBeLessThan(1e-3);
  });
});
