/**
 * An operator's own filters (windsor#362, every wave since windsor#590)
 * through the shipped worklet: `opLp` and `opHp` cut every wave's
 * fundamental and darken or thin a Noise operator; a patch without the
 * fields, or with both cutoffs 0 at any `opTrack`, renders as before to the
 * bit; the kernel and the generic loop agree to the bit with a section on,
 * on every wave, squeezed or not, carrier or modulator, silent or not; the
 * feedback taps read the wave before the filter, so only `out` changes; a
 * slide retunes a tracked section and leaves an untracked one; and a live
 * edit is heard on a sounding note. That every library patch renders as
 * before is the golden test (`fmProcessorGolden.test.ts`, unchanged by
 * windsor#362 and windsor#590); the sections' response and tracking are
 * `worklet/fm/operatorFilter.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { goertzel, loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makePatch } from '../patch/patch';
import type { Operator, PartialOperator, PartialPatch, Patch } from '../patch/patch';
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
const A4: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: 69, velocity: 1, frame: 0 }];

/** The two-pole fit's cutoffs for the 808 snare's noise (windsor#361, optimizer seed 1). */
const SNARE_808 = { opHp: 2370.0400654924615, opLp: 10089.029530313479 };

/** Every wave but Noise, which has no fundamental to cut. */
const PITCHED = Object.values(WAVE).filter((wave) => wave !== WAVE.NOISE);
const PARTIALS = [1, 0.5, 0.33, 0.25];

const play = (patch: Patch, specialise = true, notes = NOTES): Float32Array =>
  render(loaded, loaded.create(patch, 8, undefined, { specialise }), blocksFor(0.4), notes).samples;

const sameBits = (a: ArrayLike<number>, b: ArrayLike<number>): boolean =>
  a.length === b.length && Array.from(a).every((x, i) => Object.is(x, b[i]));

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

/** A lone carrier on A held at full level, the voice filter off. */
function carrier(fields: PartialOperator = {}, over: PartialPatch = {}): Patch {
  return makePatch({
    algorithm: 0,
    ops: [{ level: 1, env: { attackTime: 0.001, sustainLevel: 1 }, ...fields }],
    filter: { mode: FILTER_MODE.OFF },
    ...over,
  });
}
const noisePatch = (fields: PartialOperator = {}): Patch =>
  carrier({ wave: WAVE.NOISE, ...fields });

/** `patch` with operator `i`'s fields set. */
function withFields(patch: Patch, i: number, fields: Partial<Operator>): Patch {
  const out = structuredClone(patch);
  Object.assign(out.ops[i]!, fields);
  return out;
}

/** `patch` as a file saved before windsor#362 carries it: no filter fields on any operator. */
function withoutFields(patch: Patch): Patch {
  const out = structuredClone(patch);
  for (const op of out.ops as Partial<Operator>[]) {
    delete op.opLp;
    delete op.opHp;
    delete op.opTrack;
  }
  return out;
}

/** The left channel's magnitude at A4's fundamental, past the attack (`goertzel` reads every other sample). */
const fundamental = (patch: Patch): number =>
  goertzel(play(patch, true, A4).subarray(2 * 4096), 440, SR);
const db = (ratio: number): number => 20 * Math.log10(ratio);

const snare = (): Patch => structuredClone(PRESETS['tr808-snare']!);
const NOISE_OP = 2; // tr808-snare's Noise operator, C

describe("an operator's own filters through the worklet (windsor#590)", () => {
  it('renders a patch without the fields, or with both cutoffs 0 at any tracking, as before', () => {
    const saw = carrier({ wave: WAVE.SAW, feedback: 0.4 });
    for (const specialise of [true, false]) {
      for (const patch of [snare(), saw]) {
        const before = play(withoutFields(patch), specialise);
        expect(sameBits(play(patch, specialise), before)).toBe(true);
        expect(sameBits(play(withFields(patch, 0, { opTrack: 2 }), specialise), before)).toBe(true);
      }
    }
  });

  it('darkens a Noise carrier with opLp and thins it with opHp', () => {
    const white = brightness(play(noisePatch()));
    // Measured on Node 24: 1.99 white, 0.016 through a 1 kHz lowpass, 2.80 through an 8 kHz highpass.
    expect(white).toBeGreaterThan(1.9);
    expect(white).toBeLessThan(2.1);
    expect(brightness(play(noisePatch({ opLp: 1000 })))).toBeLessThan(0.05);
    expect(brightness(play(noisePatch({ opHp: 8000 })))).toBeGreaterThan(2.6);
  });

  it.each(PITCHED)('cuts wave %i at A4 with a lowpass and a highpass three octaves off', (wave) => {
    const op = { wave, userPartials: PARTIALS, width: wave === WAVE.PULSE ? 0.3 : 1 };
    const open = fundamental(carrier(op));
    // Two poles three octaves past the cutoff: about 36 dB down either way.
    // Measured on Node 24, every wave: −36.1 dB through 55 Hz's lowpass,
    // −36.4 to −36.5 through 3.52 kHz's highpass, −0.002 to −0.005 through both.
    expect(db(fundamental(carrier({ ...op, opLp: 55 })) / open)).toBeLessThan(-30);
    expect(db(fundamental(carrier({ ...op, opHp: 3520 })) / open)).toBeLessThan(-30);
    // A band around it passes it.
    expect(db(fundamental(carrier({ ...op, opLp: 3520, opHp: 55 })) / open)).toBeGreaterThan(-1);
  });

  it('colours the 808 snare, the kernel and the generic loop to the bit', () => {
    const coloured = withFields(snare(), NOISE_OP, SNARE_808);
    const kernel = play(coloured);
    expect(sameBits(kernel, play(coloured, false))).toBe(true);
    expect(sameBits(kernel, play(snare()))).toBe(false);
    expect(kernel.every(Number.isFinite)).toBe(true);
  });

  it.each(Object.values(WAVE))(
    'agrees in both paths on wave %i, plain and squeezed, carrier and modulator',
    (wave) => {
      const f = { opLp: 2500, opHp: 300, opTrack: 0.5 };
      for (const width of [1, 0.6]) {
        const op = { wave, width, userPartials: PARTIALS };
        const patch = makePatch({
          algorithm: 0,
          ops: [
            { ...op, level: 0.8, feedback: 0.3, ...f },
            { ...op, level: 0.4, ratio: 2, opLp: 4000 },
            { level: 0.2, ratio: 3 },
            { ...op, level: 0.3, ratio: 0.5, feedback: -0.4, opHp: 700 },
          ],
        });
        const kernel = play(patch);
        expect(sameBits(kernel, play(patch, false)), `width ${width}`).toBe(true);
        expect(sameBits(kernel, play(withoutFields(patch))), `width ${width}`).toBe(false);
      }
    },
  );

  it('agrees in both paths when a silent filtered operator is raised by a live edit', () => {
    const quiet = makePatch({
      algorithm: 7,
      ops: [{ wave: WAVE.SAW, level: 0.6 }, { wave: WAVE.SQUARE, level: 0, opLp: 900 }, {}, {}],
    });
    const loud = withFields(quiet, 1, { level: 0.7 });
    const runs = [true, false].map((specialise) => {
      const processor = loaded.create(quiet, 4, undefined, { specialise });
      processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
      const first = render(loaded, processor, blocksFor(0.1), A4).samples;
      processor.inbox({ type: 'patch', patch: loud } as unknown as ScheduledEvent);
      return [first, render(loaded, processor, blocksFor(0.1)).samples];
    });
    expect(sameBits(runs[0]![0]!, runs[1]![0]!)).toBe(true);
    expect(sameBits(runs[0]![1]!, runs[1]![1]!)).toBe(true);
  });

  it('hears a live edit on a sounding note, and a note after it starts from rest', () => {
    const processor = loaded.create(noisePatch(), 4);
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    const held: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }];
    const before = render(loaded, processor, blocksFor(0.1), held).samples;
    processor.inbox({
      type: 'patch',
      patch: noisePatch({ opLp: 800 }),
    } as unknown as ScheduledEvent);
    const after = render(loaded, processor, blocksFor(0.1)).samples;
    expect(brightness(before)).toBeGreaterThan(1.9);
    expect(brightness(after, BLOCK_FRAMES)).toBeLessThan(0.05);
  });
});

interface FilterVoice {
  active: boolean;
  fb1: Float32Array;
  fb2: Float32Array;
  out: Float32Array;
  opFilter: { lpHz: number; lpA1: number }[];
}
const sounding = (processor: ProcessorLike): FilterVoice =>
  (processor.voices as unknown as FilterVoice[]).find((v) => v.active)!;

const PARAMS = {
  pitchBend: new Float32Array([0]),
  modWheel: new Float32Array([0]),
  gain: new Float32Array([1]),
};
const OUTPUTS = [[new Float32Array(BLOCK_FRAMES), new Float32Array(BLOCK_FRAMES)]];

/** Block `b` of `processor`, its events delivered, so a test can read the voice between blocks. */
function step(processor: ProcessorLike, b: number, events: ScheduledEvent[]): void {
  const start = b * BLOCK_FRAMES;
  loaded.setFrame(start);
  for (const e of events)
    if (e.frame >= start && e.frame < start + BLOCK_FRAMES) processor.inbox(e);
  processor.process([], OUTPUTS, PARAMS);
}

/** Each block's end: operator A's feedback history and output, block by block. */
function trace(patch: Patch, specialise: boolean): { feedback: number[]; out: number[] } {
  const processor = loaded.create(patch, 4, undefined, { specialise });
  const feedback: number[] = [];
  const out: number[] = [];
  for (let b = 0; b < blocksFor(0.2); b++) {
    step(processor, b, A4);
    const voice = sounding(processor);
    feedback.push(voice.fb1[0]!, voice.fb2[0]!);
    out.push(voice.out[0]!);
  }
  return { feedback, out };
}

describe("an operator filter's taps and tracking (windsor#590)", () => {
  it("leaves a saw's feedback the same bits with its lowpass on; only its output changes", () => {
    const saw = carrier({ wave: WAVE.SAW, feedback: 0.6 });
    for (const specialise of [true, false]) {
      const open = trace(saw, specialise);
      const shut = trace(withFields(saw, 0, { opLp: 600 }), specialise);
      expect(sameBits(shut.feedback, open.feedback)).toBe(true);
      expect(sameBits(shut.out, open.out)).toBe(false);
    }
  });

  it('retunes a tracked section on a slide, and leaves an untracked one where it is set', () => {
    const slide: ScheduledEvent[] = [
      { type: 'noteOn', id: 1, note: 60, velocity: 0.8, frame: 0 },
      { type: 'noteOn', id: 2, note: 72, velocity: 0.8, frame: 4 * BLOCK_FRAMES, slide: true },
      { type: 'noteOff', id: 1, frame: 4 * BLOCK_FRAMES },
    ];
    const cutoffAfterSlide = (opTrack: number): number[] => {
      const patch = carrier({ wave: WAVE.SAW, opLp: 1000, opTrack }, { mono: true, glide: 0 });
      const processor = loaded.create(patch, 4);
      const cutoffs: number[] = [];
      for (let b = 0; b < 8; b++) {
        step(processor, b, slide);
        if (b === 3 || b === 7) cutoffs.push(sounding(processor).opFilter[0]!.lpHz);
      }
      return cutoffs;
    };
    expect(cutoffAfterSlide(1)).toEqual([1000, 2000]);
    expect(cutoffAfterSlide(-1)).toEqual([1000, 500]);
    expect(cutoffAfterSlide(0)).toEqual([1000, 1000]);
  });
});
