/**
 * The mod wheel's second destination (#586): `filter.modWheelDepth`, octaves
 * the wheel adds to the filter envelope amount, beside the LFO's
 * `lfo.modWheelDepth`. The worklet computes
 *
 *     octaves = filtEnv × (envAmount + modWheel × filter.modWheelDepth) + …
 *
 * so depth 0 is exactly today's term, and the two depths together give the
 * toggle tacowars asked for without a switch: wheel to the LFO, to the filter,
 * both, or neither.
 *
 * The cutoff is read back from the SVF's coefficients rather than inferred
 * from the audio: `a1 = 1 / (1 + g(g + k))` and `a2 = g·a1`, so
 * `g = a2 / a1` and `cutoff = atan(g) · sampleRate / π` — the inverse of
 * `setCoeffs`. The harness's `render` pins the wheel at 0, so the loop here
 * drives the k-rate param itself.
 */
import { describe, expect, it } from 'vitest';

import type { LoadedProcessor, ProcessorLike } from '../__fixtures__/workletHarness';
import { loadProcessor } from '../__fixtures__/workletHarness';
import type { PartialPatch, Patch } from '../patch/patch';
import { FILTER_MODE, makeEnvelope, makePatch } from '../patch/patch';

const loaded: LoadedProcessor = loadProcessor();
const BLOCK = 128;
const NOTE = 60;
const VELOCITY = 0.8;
/** Enough blocks for a 2 ms filter attack to reach its peak and settle. */
const BLOCKS = 40;
/** The depth every wheel case here uses: two octaves at full travel. */
const DEPTH = 2;

interface VoiceInternals {
  active: boolean;
  patch: { filter: { modWheelDepth: number; cutoff: number } };
  filtEnv: { value: number };
  svfA: { a1: number; a2: number };
}

/** A filtered saw whose filter envelope goes to 1 and stays there while held. */
const filtered = (over: PartialPatch['filter'], lfo: PartialPatch['lfo'] = {}): Patch =>
  makePatch({
    filter: {
      mode: FILTER_MODE.LOWPASS,
      cutoff: 1000,
      envAmount: 0,
      modWheelDepth: 0,
      lfoAmount: 0,
      keyTrack: 0,
      env: makeEnvelope({ attackTime: 0.002, peakLevel: 1, sustainLevel: 1 }),
      ...over,
    },
    lfo: { modWheelDepth: 0, ...lfo },
  });

interface WheelRender {
  voice: VoiceInternals;
  samples: Float32Array;
}

/** Hold one note for `BLOCKS` blocks with the wheel at `wheel`; returns the voice and its output. */
function holdWithWheel(patch: unknown, wheel: number): WheelRender {
  const processor: ProcessorLike = loaded.create(patch, 1);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const samples = new Float32Array(BLOCKS * BLOCK * 2);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([wheel]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  loaded.setFrame(0);
  processor.inbox({ type: 'noteOn', id: 1, note: NOTE, velocity: VELOCITY, frame: 0 });
  for (let b = 0; b < BLOCKS; b++) {
    loaded.setFrame(b * BLOCK);
    processor.process([], [[left, right]], params);
    samples.set(left, b * BLOCK * 2);
    samples.set(right, b * BLOCK * 2 + BLOCK);
  }
  const voice = (processor.voices as unknown as VoiceInternals[]).find((v) => v.active);
  if (!voice) throw new Error('no active voice');
  return { voice, samples };
}

/** The cutoff `setCoeffs` was last given, recovered from the SVF's coefficients. */
const cutoffOf = (voice: VoiceInternals): number =>
  (Math.atan(voice.svfA.a2 / voice.svfA.a1) * loaded.sampleRate) / Math.PI;

const sameBytes = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && a.every((sample, i) => Object.is(sample, b[i]));

describe('filter.modWheelDepth reaches the cutoff (#586)', () => {
  it('wheel 0 leaves the cutoff at filter.cutoff', () => {
    const { voice } = holdWithWheel(filtered({ modWheelDepth: DEPTH }), 0);
    expect(voice.filtEnv.value).toBeCloseTo(1, 6);
    expect(cutoffOf(voice)).toBeCloseTo(voice.patch.filter.cutoff, 6);
  });

  it('wheel 1 at the envelope peak raises the cutoff by the envelope value × depth octaves', () => {
    const { voice } = holdWithWheel(filtered({ modWheelDepth: DEPTH }), 1);
    const expected = voice.patch.filter.cutoff * Math.pow(2, voice.filtEnv.value * DEPTH);
    expect(voice.filtEnv.value).toBeCloseTo(1, 6);
    expect(cutoffOf(voice)).toBeCloseTo(expected, 6);
  });

  it('a negative depth lowers it by the same amount', () => {
    const { voice } = holdWithWheel(filtered({ modWheelDepth: -DEPTH }), 1);
    const expected = voice.patch.filter.cutoff * Math.pow(2, -voice.filtEnv.value * DEPTH);
    expect(cutoffOf(voice)).toBeCloseTo(expected, 6);
  });

  it('the wheel at depth d is exactly envAmount d: same coefficients, same audio', () => {
    // `fenv × (0 + 1 × d)` and `fenv × (d + 1 × 0)` are the same double, so the
    // two renders are byte-identical, not merely close.
    const wheel = holdWithWheel(filtered({ modWheelDepth: DEPTH, envAmount: 0 }), 1);
    const knob = holdWithWheel(filtered({ modWheelDepth: 0, envAmount: DEPTH }), 1);
    expect(Object.is(wheel.voice.svfA.a1, knob.voice.svfA.a1)).toBe(true);
    expect(Object.is(wheel.voice.svfA.a2, knob.voice.svfA.a2)).toBe(true);
    expect(sameBytes(wheel.samples, knob.samples)).toBe(true);
  });

  it('half travel adds half the depth', () => {
    const { voice } = holdWithWheel(filtered({ modWheelDepth: DEPTH }), 0.5);
    const expected = voice.patch.filter.cutoff * Math.pow(2, voice.filtEnv.value * DEPTH * 0.5);
    expect(cutoffOf(voice)).toBeCloseTo(expected, 6);
  });
});

describe('the LFO path is unchanged by the filter depth (#586)', () => {
  const vibrato = { amount: 0.5, toPitch: 1, rate: 6 };

  it('with lfo.modWheelDepth 0 the wheel changes nothing about the LFO or the audio', () => {
    const patch = filtered({ modWheelDepth: 0 }, { ...vibrato, modWheelDepth: 0 });
    const rest = holdWithWheel(patch, 0);
    const full = holdWithWheel(patch, 1);
    expect(sameBytes(rest.samples, full.samples)).toBe(true);
    expect(Object.is(cutoffOf(rest.voice), cutoffOf(full.voice))).toBe(true);
  });

  it('with lfo.modWheelDepth 1 the wheel still deepens the vibrato as before', () => {
    const patch = filtered({ modWheelDepth: 0 }, { ...vibrato, modWheelDepth: 1 });
    const rest = holdWithWheel(patch, 0);
    const full = holdWithWheel(patch, 1);
    expect(sameBytes(rest.samples, full.samples)).toBe(false);
    // The filter is untouched by the LFO here (lfoAmount 0), so the cutoff
    // stays put even though the wheel is moving the pitch.
    expect(Object.is(cutoffOf(rest.voice), cutoffOf(full.voice))).toBe(true);
  });
});

describe('the worklet normaliser defaults the field (#586)', () => {
  it('reads an absent filter.modWheelDepth as 0, matching makePatch()', () => {
    const raw = structuredClone(filtered({})) as { filter: Partial<Patch['filter']> };
    delete raw.filter.modWheelDepth;
    const { voice } = holdWithWheel(raw, 1);
    expect(voice.patch.filter.modWheelDepth).toBe(makePatch().filter.modWheelDepth);
    expect(voice.patch.filter.modWheelDepth).toBe(0);
    expect(cutoffOf(voice)).toBeCloseTo(voice.patch.filter.cutoff, 6);
  });

  it('carries a set depth through', () => {
    const { voice } = holdWithWheel(filtered({ modWheelDepth: -DEPTH }), 0);
    expect(voice.patch.filter.modWheelDepth).toBe(-DEPTH);
  });
});
