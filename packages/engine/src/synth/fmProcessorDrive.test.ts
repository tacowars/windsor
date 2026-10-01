/**
 * The voice's drive stage (windsor#300) through the shipped worklet: it no
 * longer needs the filter, both render paths agree to the bit for every
 * shape, bias and tone, silence stays silent at any bias, the bias makes even
 * harmonics, the tone is a lowpass from about 1 kHz to open, and a voice
 * whose tone pole has run still ends. The curves and the control half are
 * `worklet/fm/voiceDrive.test.ts`; that every library patch renders as
 * before is the golden test.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import { DRIVE_SHAPE, FILTER_MODE, makePatch } from '../patch/patch';
import type { DriveSettings, PartialPatch, Patch } from '../patch/patch';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK_FRAMES);

/** Off block and control boundaries, so the part renders chunks of odd lengths. */
const NOTES: ScheduledEvent[] = [
  { type: 'noteOn', id: 1, note: 45, velocity: 0.9, frame: 0 },
  { type: 'noteOn', id: 2, note: 64, velocity: 0.7, frame: 3 * BLOCK_FRAMES + 17 },
  { type: 'noteOff', id: 1, frame: blocksFor(0.25) * BLOCK_FRAMES + 5 },
];

/** Operator A carrying a sine with B on it: a few harmonics for the shaper to bend. */
function voicePatch(drive: Partial<DriveSettings>, filter: PartialPatch['filter'] = {}): Patch {
  return makePatch({
    algorithm: 0,
    ops: [{ level: 1 }, { level: 0.35, ratio: 2 }],
    filter: { mode: FILTER_MODE.OFF, ...filter },
    drive,
  } as PartialPatch);
}

const play = (patch: Patch, specialise = true): Float32Array =>
  render(loaded, loaded.create(patch, 8, undefined, { specialise }), blocksFor(0.5), NOTES).samples;

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;

const rms = (xs: Float32Array): number =>
  Math.sqrt(xs.reduce((sum, x) => sum + x * x, 0) / xs.length);

function difference(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((x, i) => x - b[i]!);
}

const SHAPES = Object.entries(DRIVE_SHAPE);

/** One held sine at a fixed `hz` through the drive, the filter Off, at a steady level. */
function sinePatch(hz: number, volume: number, drive: Partial<DriveSettings>): Patch {
  return makePatch({
    volume,
    ops: [
      { fixed: true, fixedHz: hz, env: { attackTime: 0.001, decayTime: 0.001, sustainLevel: 1 } },
    ],
    drive,
  } as PartialPatch);
}

/** The left channel of 0.5 s to 1 s of a held note: a whole number of cycles of each test tone. */
function steady(patch: Patch): Float64Array {
  const NOTE: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }];
  const samples = render(loaded, loaded.create(patch), blocksFor(1), NOTE).samples;
  const from = SR / 2;
  return Float64Array.from({ length: SR / 2 }, (_, i) => samples[(from + i) * 2]!);
}

/** The magnitude at `hz` over `samples`, which hold a whole number of its cycles. */
function level(samples: Float64Array, hz: number): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < samples.length; i++) {
    const w = (2 * Math.PI * hz * i) / SR;
    re += samples[i]! * Math.cos(w);
    im -= samples[i]! * Math.sin(w);
  }
  return Math.hypot(re, im) / samples.length;
}

const db = (ratio: number): number => 20 * Math.log10(ratio);

describe('the voice drive stage (windsor#300)', () => {
  it('drives a patch with the filter Off, which before played clean', () => {
    const clean = play(voicePatch({}));
    const driven = play(voicePatch({ gain: 2 }));
    expect(rms(difference(driven, clean)) / rms(clean)).toBeGreaterThan(0.1);
  });

  it('renders Off as it rendered on at an open cutoff, give or take the filter', () => {
    const off = play(voicePatch({ gain: 2 }));
    // The pre-windsor#300 path: the soft clip ahead of a lowpass the clamp opens to 0.98 Nyquist.
    const open = play(
      voicePatch({ gain: 2 }, { mode: FILTER_MODE.LOWPASS, cutoff: SR, resonance: 0.5 }),
    );
    // Measured on Node 24: −49.9 dB, the open lowpass's own phase and roll-off.
    expect(20 * Math.log10(rms(difference(off, open)) / rms(open))).toBeLessThan(-45);
  });

  it.each(SHAPES)(
    'renders %s bit-identical through the kernel and the generic loop',
    (_n, shape) => {
      for (const filter of [{}, { mode: FILTER_MODE.BANDPASS, cutoff: 900, slope24: true }]) {
        const patch = voicePatch({ gain: 2.5, shape, bias: -0.35, tone: 0.4 }, filter);
        const kernel = play(patch);
        expect(sameBits(kernel, play(patch, false))).toBe(true);
        expect(rms(kernel)).toBeGreaterThan(0);
      }
    },
  );

  it.each(SHAPES)('turns silent carriers into exactly 0 for %s at bias ±1', (_n, shape) => {
    for (const bias of [-1, 1]) {
      const patch = makePatch({
        ops: [{ level: 0 }],
        filter: { mode: FILTER_MODE.HIGHPASS, cutoff: 200 },
        drive: { gain: 3, shape, bias, tone: 0.3 },
      } as PartialPatch);
      expect(render(loaded, loaded.create(patch), blocksFor(0.1), NOTES).peak).toBe(0);
    }
  });

  it('makes H2 from a sine at bias 0.3 with soft, and none to speak of at bias 0', () => {
    const h2 = (bias: number): number => {
      const out = steady(sinePatch(1000, 0.5, { gain: 2, bias }));
      return db(level(out, 2000) / level(out, 1000));
    };
    // Measured on Node 24 (a 0.5 sine at 1 kHz, gain 2): H2 at −20.1 dB
    // below H1 at bias 0.3; at bias 0 the soft clip is odd and H2 is −298 dB,
    // nothing but the DFT's own rounding.
    expect(h2(0.3)).toBeGreaterThan(-21);
    expect(h2(0.3)).toBeLessThan(-19);
    expect(h2(0)).toBeLessThan(-200);
  });

  it('runs the tone from about 1 kHz at 0 to open at 1', () => {
    // A small signal, so the soft curve is all but linear and the pole is what moves the level.
    const response = (tone: number, hz: number): number =>
      db(
        level(steady(sinePatch(hz, 0.02, { gain: 1.001, tone })), hz) /
          level(steady(sinePatch(hz, 0.02, { gain: 1.001 })), hz),
      );
    // Measured on Node 24: −3.0 dB at 1 kHz and −19.0 dB at 8 kHz at tone 0,
    // −0.2 dB at 1 kHz at tone 0.5, and the same bits at tone 1.
    expect(response(0, 1000)).toBeCloseTo(-3, 0);
    expect(response(0, 8000)).toBeLessThan(-15);
    expect(response(0.5, 1000)).toBeGreaterThan(-1);
    expect(response(1, 8000)).toBe(0);
  });

  it('ends a released voice whose tone pole has run', () => {
    const patch = voicePatch({ gain: 3, shape: DRIVE_SHAPE.TUBE, bias: 0.4, tone: 0 });
    patch.ops[0]!.env.releaseTime = 0.05;
    const processor = loaded.create(patch, 8);
    render(loaded, processor, blocksFor(0.2), [NOTES[0]!]);
    render(loaded, processor, blocksFor(0.5), [{ type: 'noteOff', id: 1, frame: 0 }]);
    expect(processor.voices.filter((v) => v.active)).toHaveLength(0);
  });
});
