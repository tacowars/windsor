/**
 * A Noise operator's own colour (windsor#362) through the shipped worklet:
 * `noiseLp` and `noiseHp` are heard on a Noise operator, and darken or thin
 * its noise; every other wave ignores them to the bit; a patch without them
 * renders as one with both at 0; the kernel and the generic loop agree to the
 * bit with them on, a Noise carrier, a Noise modulator and two Noise
 * operators alike; and a live edit is heard on a sounding note. That every
 * library patch renders as before is the golden test
 * (`fmProcessorGolden.test.ts`, unchanged by windsor#362); the sections'
 * response is `worklet/fm/noiseColour.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makePatch } from '../patch/patch';
import type { Operator, PartialOperator, Patch } from '../patch/patch';
import { PRESETS } from '../patch/presets';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK_FRAMES);

/** Off block and control boundaries, so the part renders chunks of odd lengths; a second note overlaps. */
const NOTES: ScheduledEvent[] = [
  { type: 'noteOn', id: 1, note: 50, velocity: 0.9, frame: 0 },
  { type: 'noteOn', id: 2, note: 62, velocity: 0.7, frame: 3 * BLOCK_FRAMES + 17 },
  { type: 'noteOff', id: 1, frame: blocksFor(0.2) * BLOCK_FRAMES + 5 },
];

/** The two-pole fit's cutoffs for the 808 snare's noise (windsor#361, optimizer seed 1). */
const SNARE_808 = { noiseHp: 2370.0400654924615, noiseLp: 10089.029530313479 };

const play = (patch: Patch, specialise = true, notes = NOTES): Float32Array =>
  render(loaded, loaded.create(patch, 8, undefined, { specialise }), blocksFor(0.4), notes).samples;

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;

/** Brightness: the left channel's first difference's energy over its energy (2 for white noise). */
function brightness(samples: Float32Array, from = 0): number {
  let energy = 0;
  let slope = 0;
  for (let i = from * 2 + 2; i < samples.length; i += 2) {
    const x = samples[i]!;
    const d = x - samples[i - 2]!;
    energy += x * x;
    slope += d * d;
  }
  return slope / energy;
}

/** A lone Noise carrier held at full level on A, the voice filter off. */
function noisePatch(fields: PartialOperator = {}): Patch {
  return makePatch({
    algorithm: 0,
    ops: [
      {
        wave: WAVE.NOISE,
        level: 1,
        env: { attackTime: 0.001, sustainLevel: 1 },
        ...fields,
      },
    ],
    filter: { mode: FILTER_MODE.OFF },
  });
}

/** `patch` with operator `i`'s fields set. */
function withFields(patch: Patch, i: number, fields: Partial<Operator>): Patch {
  const out = structuredClone(patch);
  Object.assign(out.ops[i]!, fields);
  return out;
}

/** `patch` as a file saved before windsor#362 carries it: no `noiseLp` or `noiseHp` on any operator. */
function withoutFields(patch: Patch): Patch {
  const out = structuredClone(patch);
  for (const op of out.ops as Partial<Operator>[]) {
    delete op.noiseLp;
    delete op.noiseHp;
  }
  return out;
}

const snare = (): Patch => structuredClone(PRESETS['tr808-snare']!);
const NOISE_OP = 2; // tr808-snare's Noise operator, C

describe("a Noise operator's colour through the worklet (windsor#362)", () => {
  it('renders a patch without the fields bit for bit as one with both at 0, in both paths', () => {
    for (const specialise of [true, false]) {
      expect(sameBits(play(withoutFields(snare()), specialise), play(snare(), specialise))).toBe(
        true,
      );
    }
  });

  it('darkens a Noise carrier with noiseLp and thins it with noiseHp', () => {
    const white = brightness(play(noisePatch()));
    // Measured on Node 24: 1.99 white, 0.016 through a 1 kHz lowpass, 2.80 through an 8 kHz highpass.
    expect(white).toBeGreaterThan(1.9);
    expect(white).toBeLessThan(2.1);
    expect(brightness(play(noisePatch({ noiseLp: 1000 })))).toBeLessThan(0.05);
    expect(brightness(play(noisePatch({ noiseHp: 8000 })))).toBeGreaterThan(2.6);
  });

  it('ignores the fields on every other wave, to the bit, in both paths', () => {
    for (const wave of [WAVE.SINE, WAVE.SAW, WAVE.PULSE]) {
      const patch = makePatch({
        algorithm: 0,
        ops: [
          { wave, level: 1 },
          { level: 0.4, ratio: 2 },
        ],
      });
      const fields = { noiseLp: 900, noiseHp: 3000 };
      const set = withFields(withFields(patch, 0, fields), 1, fields);
      for (const specialise of [true, false]) {
        expect(sameBits(play(set, specialise), play(patch, specialise))).toBe(true);
      }
    }
  });

  it('colours the 808 snare, the kernel and the generic loop to the bit', () => {
    const coloured = withFields(snare(), NOISE_OP, SNARE_808);
    const kernel = play(coloured);
    expect(sameBits(kernel, play(coloured, false))).toBe(true);
    expect(sameBits(kernel, play(snare()))).toBe(false);
    expect(kernel.every(Number.isFinite)).toBe(true);
  });

  it.each([
    ['a lowpass alone', { noiseLp: 3000 }],
    ['a highpass alone', { noiseHp: 1500 }],
    ['both', { noiseLp: 7000, noiseHp: 700 }],
  ])('agrees in both paths for %s, on a Noise modulator and on two Noise operators', (_n, f) => {
    // A Noise modulator (D) into a sine carrier, and two Noise carriers (Additive).
    const modulator = makePatch({
      algorithm: 0,
      ops: [{ level: 1 }, { level: 0 }, { level: 0 }, { wave: WAVE.NOISE, level: 0.3, ...f }],
    });
    const pair = makePatch({
      algorithm: 7,
      ops: [
        { wave: WAVE.NOISE, level: 0.7, ...f },
        { level: 0.5 },
        { wave: WAVE.NOISE, level: 0.6, noiseLp: 5000 },
        { level: 0 },
      ],
    });
    for (const patch of [modulator, pair]) {
      const kernel = play(patch);
      expect(sameBits(kernel, play(patch, false))).toBe(true);
      expect(sameBits(kernel, play(withFields(patch, 0, { noiseLp: 0, noiseHp: 0 })))).toBe(
        patch === modulator,
      );
    }
  });

  it('hears a live edit on a sounding note, and a note after it starts from rest', () => {
    const processor = loaded.create(noisePatch(), 4);
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    const held: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }];
    const before = render(loaded, processor, blocksFor(0.1), held).samples;
    processor.inbox({
      type: 'patch',
      patch: noisePatch({ noiseLp: 800 }),
    } as unknown as ScheduledEvent);
    const after = render(loaded, processor, blocksFor(0.1)).samples;
    expect(brightness(before)).toBeGreaterThan(1.9);
    expect(brightness(after, BLOCK_FRAMES)).toBeLessThan(0.05);
  });
});
