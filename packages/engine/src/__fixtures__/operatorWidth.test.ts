/**
 * Operator width and the PULSE wave (windsor#55, record
 * `2026-09-28-operator-width-pulse-and-a-second-lfo`). Width squeezes an
 * operator's wave into that fraction of its period and holds 0 for the rest;
 * on PULSE it is the duty of a pulse read as two band-limited saws. Driven
 * through the shipped bundle (`__fixtures__/workletHarness.ts`) and read with
 * Goertzel windows, in the style of `lfoRoutes.test.ts`, so no DSP is
 * duplicated here: the expected levels are the Fourier series of the shapes.
 */
import { describe, expect, it } from 'vitest';

import type { PartialOperator, PartialPatch } from '../patch/patch';
import { LFO_SHAPE, makeEnvelope, makePatch, WAVE } from '../patch/patch';
import type { LoadedProcessor, ProcessorLike, ScheduledEvent } from './workletHarness';
import { goertzel, loadProcessor, render } from './workletHarness';

const loaded: LoadedProcessor = loadProcessor();
const SR = loaded.sampleRate;

/** A4, whose period divides 4800 frames into exactly 44 cycles, so every harmonic sits on a bin. */
const NOTE = 69;
const F0 = 440;
/** A steady window clear of the attack. */
const STEADY: [number, number] = [1200, 6000];
const BLOCKS = Math.ceil(12000 / 128);
/** Held flat: an instant attack to a sustain of 1, no velocity scaling. */
const FLAT_ENV = makeEnvelope({ attackTime: 0.001, peakLevel: 1, sustainLevel: 1 });
const ALG_SERIES = 0;
const ALG_ADDITIVE = 7;

const dB = (ratio: number): number => 20 * Math.log10(ratio);

/** Operator A alone, as a carrier, with `op` over a flat held sine. */
function lone(op: PartialOperator, extra: PartialPatch = {}): PartialPatch {
  return {
    algorithm: ALG_ADDITIVE,
    ops: [{ level: 1, velSens: 0, env: FLAT_ENV, ...op }, { level: 0 }, { level: 0 }, { level: 0 }],
    ...extra,
  };
}

function hold(partial: PartialPatch, blocks = BLOCKS, specialise = true): Float32Array {
  const processor = loaded.create(makePatch(partial), 1, undefined, { specialise });
  const events: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 }];
  const result = render(loaded, processor, blocks, events);
  expect(result.nonFinite).toBe(0);
  return result.samples;
}

function windowOf(samples: Float32Array, [start, end]: [number, number]): Float32Array {
  return samples.subarray(start * 2, end * 2);
}

/** The amplitude of harmonic `h` of A4 in a window: Goertzel's magnitude, doubled to a sine's peak. */
function harmonic(samples: Float32Array, h: number, span = STEADY): number {
  return 2 * goertzel(windowOf(samples, span), h * F0, SR);
}

function mean(samples: Float32Array, span: [number, number]): number {
  const w = windowOf(samples, span);
  let sum = 0;
  for (let i = 0; i < w.length; i += 2) sum += w[i] ?? 0;
  return sum / (w.length / 2);
}

function rms(samples: Float32Array, span: [number, number]): number {
  const w = windowOf(samples, span);
  let energy = 0;
  for (let i = 0; i < w.length; i += 2) energy += (w[i] ?? 0) ** 2;
  return Math.sqrt(energy / (w.length / 2));
}

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;

describe('operator width on a sine', () => {
  const plain = hold(lone({}));
  const half = hold(lone({ width: 0.5 }));

  it('renders width 1 bit for bit as a patch that never mentions width', () => {
    expect(sameBits(hold(lone({ width: 1 })), plain)).toBe(true);
  });

  it('turns a pure sine into one with a strong second harmonic at width 0.5', () => {
    expect(dB(harmonic(plain, 2) / harmonic(plain, 1))).toBeLessThan(-60);
    expect(dB(harmonic(half, 2) / harmonic(half, 1))).toBeGreaterThan(-20);
  });

  it('matches the Fourier series of a sine squeezed into half its period', () => {
    // sin(4πt) on [0, ½), 0 on [½, 1): odd harmonic n is 4/(π|4 - n²|) of
    // the plain sine, the second is ½, and every other even one vanishes.
    const unit = harmonic(plain, 1);
    const odd = (n: number): number => 4 / (Math.PI * Math.abs(4 - n * n));
    for (const n of [1, 3, 5]) {
      expect(Math.abs(dB(harmonic(half, n) / unit) - dB(odd(n)))).toBeLessThan(0.5);
    }
    expect(Math.abs(dB(harmonic(half, 2) / unit) - dB(0.5))).toBeLessThan(0.5);
    expect(dB(harmonic(half, 4) / unit)).toBeLessThan(-40);
  });

  it('squeezes the raw saw and square too, and holds 0 for the rest of the period', () => {
    for (const wave of [WAVE.SAW_D, WAVE.SQUARE_D, WAVE.SAW, WAVE.TRIANGLE]) {
      const squeezed = hold(lone({ wave, width: 0.25 }));
      expect(rms(squeezed, STEADY)).toBeGreaterThan(0.01);
      expect(rms(squeezed, STEADY)).toBeLessThan(rms(hold(lone({ wave })), STEADY));
    }
  });
});

describe('width on a noise operator', () => {
  it('is ignored: a noise draw has no phase to squeeze', () => {
    expect(
      sameBits(hold(lone({ wave: WAVE.NOISE, width: 0.25 })), hold(lone({ wave: WAVE.NOISE }))),
    ).toBe(true);
  });
});

/** The voice fields the mip test reads and drives; the worklet is untyped JS. */
interface WidthVoice {
  active: boolean;
  tables: (Float32Array | null)[];
  /** The part's bend, wheel and cutoff are the processor's, this quantum's (windsor#233). */
  updateControl(n: number): void;
  render(outL: Float32Array, outR: Float32Array, off: number, n: number): void;
}

/** The part's one sounding voice, after a held A4 has run a few blocks. */
function heldVoice(
  partial: PartialPatch,
  live = false,
): { processor: ProcessorLike; voice: WidthVoice } {
  const processor = loaded.create(makePatch(partial), 1);
  if (live) processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
  const on: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 }];
  render(loaded, processor, 4, on);
  const voice = (processor.voices as unknown as WidthVoice[]).find((v) => v.active)!;
  return { processor, voice };
}

describe('the mip table while width ramps', () => {
  it('holds the narrow end’s table through a block that opens 0.05 to 1, then the wide one', () => {
    const narrowTable = heldVoice(lone({ width: 0.05 })).voice.tables[0];
    const wideTable = heldVoice(lone({ width: 1 })).voice.tables[0];
    expect(narrowTable).not.toBe(wideTable);

    const { processor, voice } = heldVoice(lone({ width: 0.05 }), true);
    processor.inbox({ type: 'patch', patch: makePatch(lone({ width: 1 })) } as never);
    const block = loaded.ctrlInterval;
    const outL = new Float32Array(block);
    const outR = new Float32Array(block);
    voice.updateControl(block);
    expect(voice.tables[0]).toBe(narrowTable);
    voice.render(outL, outR, 0, block);
    voice.updateControl(block);
    expect(voice.tables[0]).toBe(wideTable);
  });
});

describe('a width stepped mid-note', () => {
  it('ramps from 1 to 0.3 with no jump beyond the wave’s own swing', () => {
    const processor: ProcessorLike = loaded.create(makePatch(lone({})), 1);
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    const on: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 }];
    const before = render(loaded, processor, 20, on).samples;
    processor.inbox({ type: 'patch', patch: makePatch(lone({ width: 0.3 })) } as never);
    const after = render(loaded, processor, 20).samples;

    const joined = new Float32Array(before.length + after.length);
    joined.set(before);
    joined.set(after, before.length);
    let lo = Infinity,
      hi = -Infinity,
      jump = 0,
      steadyJump = 0;
    const swapAt = before.length / 2;
    for (let i = 1200; i < joined.length / 2; i++) {
      const x = joined[i * 2] ?? 0;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      const d = Math.abs(x - (joined[(i - 1) * 2] ?? 0));
      if (i >= swapAt && i < swapAt + 64) jump = Math.max(jump, d);
      if (i >= swapAt + 256) steadyJump = Math.max(steadyJump, d);
    }
    expect(jump).toBeLessThanOrEqual(hi - lo);
    // Tighter than the criterion: the ramp's steepest step stays within twice
    // the squeezed wave's own (1.55 times on the day this was written).
    expect(jump).toBeLessThan(2 * steadyJump);
  });
});

describe('the PULSE wave', () => {
  const pulse = (width: number): Float32Array => hold(lone({ wave: WAVE.PULSE, width }));

  it('is a square at width 0.5: every even harmonic below -60 dB', () => {
    const square = pulse(0.5);
    const f = harmonic(square, 1);
    expect(f).toBeGreaterThan(0.1);
    for (const h of [2, 4, 6, 8, 10, 12]) {
      expect(dB(harmonic(square, h) / f)).toBeLessThan(-60);
    }
    expect(dB(harmonic(square, 3) / f)).toBeCloseTo(dB(1 / 3), 0);
  });

  it('nulls the fourth harmonic at width 0.25, and not the second', () => {
    const quarter = pulse(0.25);
    const f = harmonic(quarter, 1);
    expect(dB(harmonic(quarter, 4) / f)).toBeLessThan(-40);
    expect(dB(harmonic(quarter, 2) / f)).toBeGreaterThan(-10);
  });

  it('is silent at width 1: the two saws cancel', () => {
    expect(rms(pulse(1), STEADY)).toBeLessThan(1e-6);
  });

  it('stays zero-mean at a fixed width and while the width sweeps', () => {
    const quarter = pulse(0.25);
    expect(dB(Math.abs(mean(quarter, STEADY)) / rms(quarter, STEADY))).toBeLessThan(-60);
    const swept = hold(
      lone(
        { wave: WAVE.PULSE, width: 0.5 },
        { lfo: { shape: LFO_SHAPE.SINE, rate: 3, amount: 1, toWidth: [0.4, 0, 0, 0] } },
      ),
      Math.ceil(48000 / 128),
    );
    // A whole number of LFO cycles and of carrier cycles: 1 s holds 3 and 440.
    const second: [number, number] = [0, 48000];
    expect(dB(Math.abs(mean(swept, second)) / rms(swept, second))).toBeLessThan(-60);
  });

  it('modulates as a pulse: finite, and not the saw it is read from', () => {
    const series = (wave: number): Float32Array =>
      hold({
        algorithm: ALG_SERIES,
        ops: [
          { level: 1, velSens: 0, env: FLAT_ENV },
          { level: 0.5, velSens: 0, env: FLAT_ENV, wave, width: 0.5 },
          { level: 0 },
          { level: 0 },
        ],
      });
    const byPulse = series(WAVE.PULSE);
    const bySaw = series(WAVE.SAW);
    let diff = 0;
    for (let i = 0; i < byPulse.length; i++) {
      diff = Math.max(diff, Math.abs((byPulse[i] ?? 0) - (bySaw[i] ?? 0)));
    }
    expect(rms(byPulse, STEADY)).toBeGreaterThan(0.1);
    expect(diff).toBeGreaterThan(0.1);
  });
});

describe('width and PULSE in the kernel', () => {
  it('render the same bits as the generic loop, ramping and held', () => {
    const partial: PartialPatch = {
      algorithm: ALG_SERIES,
      ops: [
        { level: 1, velSens: 0, env: FLAT_ENV, width: 0.7 },
        { level: 0.4, velSens: 0, env: FLAT_ENV, wave: WAVE.PULSE, width: 0.3 },
        { level: 0.3, velSens: 0, env: FLAT_ENV, wave: WAVE.SAW_D, width: 0.6 },
        { level: 0.2, velSens: 0, env: FLAT_ENV, wave: WAVE.SQUARE_D },
      ],
      lfo: { shape: LFO_SHAPE.TRIANGLE, rate: 7, amount: 1, toWidth: [0.2, 0.15, 0.3, 0.5] },
      lfo2: { shape: LFO_SHAPE.SQUARE, rate: 3, amount: 1, toWidth: [0.1, 0, 0, -0.4] },
    };
    const kernel = hold(partial, BLOCKS, true);
    const generic = hold(partial, BLOCKS, false);
    expect(rms(kernel, STEADY)).toBeGreaterThan(0.01);
    expect(sameBits(kernel, generic)).toBe(true);
  });
});
