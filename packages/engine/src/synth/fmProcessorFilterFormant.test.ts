/**
 * The Formant filter mode (windsor#331) through the shipped worklet: white
 * noise through a vowel shows its three formants where the table puts them
 * and at its levels, unmoved by the note; the vowel morphs and clamps; the
 * filter's modulation (envelope, key track) moves the three together, and a
 * cutoff lane or step leaves them alone, as the knob does (windsor#419); the resonance sets one Q, capped, and every peak keeps
 * its level across it; `slope24` and `cutoff` are not heard in this mode;
 * and a Formant voice ends after its release as any filtered voice does,
 * its third section included. That the kernel and the generic loop sum the
 * peaks to the bit is `fmProcessorKernel.test.ts`; that no factory preset
 * changed is the golden test.
 */
import { describe, expect, it } from 'vitest';

import { peakNear, responseOf, transfer } from '../__fixtures__/powerSpectrum';
import type { Peak, PowerSpectrum } from '../__fixtures__/powerSpectrum';
import { loadProcessor } from '../__fixtures__/workletHarness';
import type { ProcessorLike } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch } from '../patch/patch';
import type { FilterSettings, Patch } from '../patch/patch';
import { FORMANT_MAKEUP, FORMANT_Q_MAX, FORMANT_Q_PER_RESONANCE } from '../worklet/fm/fmConstants';
import { FORMANT_VOWELS } from '../worklet/fm/formantTables';
import { VOICE_TARGET_COUNT, VT_CUTOFF } from '../worklet/fm/voiceTargetTables';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;
const FORMANT = FILTER_MODE.FORMANT;

/** The worklet's filter section, as these tests read and drive it. */
interface SectionLike {
  cutoffHz: number;
  q: number;
  k: number;
  a1: number;
  a2: number;
  a3: number;
  ic1: number;
  ic2: number;
  /** The Formant peak's gain into the sum. */
  gain: number;
  process(v0: number, mode: number): number;
  reset(): void;
}

interface FormantVoice {
  active: boolean;
  dormant: boolean;
  svfA: SectionLike;
  svfB: SectionLike;
  svfC: SectionLike;
}

const held = { attackTime: 0, decayTime: 0.01, sustainLevel: 1, peakLevel: 1 };

/** The part's k-rate parameters at rest. */
const PARAMS = {
  pitchBend: new Float32Array([0]),
  modWheel: new Float32Array([0]),
  gain: new Float32Array([1]),
};

/** A lone held Noise carrier through `filter`: white noise into the filter. */
function noisePatch(filter: Partial<FilterSettings>): Patch {
  return makePatch({
    algorithm: 0,
    volume: 0.5,
    ops: [{ wave: WAVE.NOISE, level: 1, velSens: 0, env: held }, {}, {}, {}],
    filter: { mode: FORMANT, env: makeEnvelope(held), ...filter },
  });
}

interface Held {
  processor: ProcessorLike;
  voice: FormantVoice;
  left: Float32Array;
}

/**
 * One note held `seconds`, with a song lane on the cutoff at `cutoffLane`
 * octaves and the note's step on it at `cutoffStep` (windsor#419); the left
 * channel.
 */
function hold(patch: Patch, seconds: number, note = 60, cutoffLane = 0, cutoffStep = 0): Held {
  const processor = loaded.create(patch, 1, undefined, { voiceSlots: ['filter.cutoff'] });
  const blocks = Math.ceil((seconds * SR) / BLOCK);
  const left = new Float32Array(blocks * BLOCK);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  const params = { ...PARAMS, voiceSlot0: new Float32Array([cutoffLane]) };
  const stepMod = new Array<number>(VOICE_TARGET_COUNT).fill(0);
  stepMod[VT_CUTOFF] = cutoffStep;
  loaded.setFrame(0);
  processor.inbox({ type: 'noteOn', id: 1, note, velocity: 1, frame: 0, stepMod });
  for (let b = 0; b < blocks; b++) {
    loaded.setFrame(b * BLOCK);
    processor.process([], [[outL, outR]], params);
    left.set(outL, b * BLOCK);
  }
  const voice = (processor.voices as unknown as FormantVoice[]).find((v) => v.active)!;
  return { processor, voice, left };
}

const sections = (voice: FormantVoice): SectionLike[] => [voice.svfA, voice.svfB, voice.svfC];
const centres = (voice: FormantVoice): number[] => sections(voice).map((s) => s.cutoffHz);

/** A fresh section of the bundle's, tuned as `tuned` is and at rest. */
function copyOf(tuned: SectionLike): SectionLike {
  const section = new (tuned.constructor as new () => SectionLike)();
  Object.assign(section, { a1: tuned.a1, a2: tuned.a2, a3: tuned.a3, k: tuned.k });
  return section;
}

const SIZE = 8192;

/**
 * The voice's Formant filter as it is tuned: an impulse through fresh copies
 * of its three sections, summed by its gains, as both render loops sum them.
 */
function tunedResponse(voice: FormantVoice): PowerSpectrum {
  const [a, b, c] = sections(voice).map(copyOf);
  const [gA, gB, gC] = sections(voice).map((s) => s.gain);
  const bp = FILTER_MODE.BANDPASS;
  const h = Float64Array.from({ length: SIZE }, (_, i) => {
    const x = i === 0 ? 1 : 0;
    return gA! * a!.process(x, bp) + gB! * b!.process(x, bp) + gC! * c!.process(x, bp);
  });
  return responseOf(h, SR, SIZE);
}

interface Heard {
  /** The response white noise met through the voice: its render against the same noise with the filter Off. */
  noise: PowerSpectrum;
  /** The response of the filter the voice was tuned to. */
  tuned: PowerSpectrum;
}

/** White noise through `filter` on `note` for 4 s (the part's seed fixes the noise; 0.1 s skipped). */
function heard(filter: Partial<FilterSettings>, note = 60): Heard {
  const skip = (left: Float32Array): Float32Array => left.subarray(SR / 10);
  const input = skip(hold(noisePatch({ ...filter, mode: FILTER_MODE.OFF }), 4, note).left);
  const { voice, left } = hold(noisePatch(filter), 4, note);
  return { noise: transfer(input, skip(left), SR, SIZE), tuned: tunedResponse(voice) };
}

/** The largest gap in dB between the two responses from 200 Hz to 6 kHz. */
function gapDb({ noise, tuned }: Heard): number {
  let gap = 0;
  for (let k = Math.round(200 / noise.binHz); k <= Math.round(6000 / noise.binHz); k++) {
    gap = Math.max(gap, Math.abs(10 * Math.log10(noise.power[k]! / tuned.power[k]!)));
  }
  return gap;
}

const peaksOf = (response: PowerSpectrum, hz: readonly number[]): Peak[] =>
  hz.map((f) => peakNear(response, f * 0.85, f * 1.15));
const db = (gain: number): number => 20 * Math.log10(gain);
const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
const off = (got: number, want: number): number => Math.abs(got / want - 1);

/**
 * White noise through the voice is read as the response it met (`noise`),
 * held to the tuned filter's (`tuned`) across the band; the peaks are read on
 * the tuned response, where a broad peak's top is not lost in the noise
 * estimate's scatter (a Q 5.7 peak falls 0.003 dB 5 Hz either side of 2250).
 */
describe('the Formant mode through white noise (windsor#331)', () => {
  const A = FORMANT_VOWELS[0]!;

  it('puts the vowel "a" at the default resonance where the table does, at its levels', () => {
    const response = heard({ vowel: 0 });
    expect(gapDb(response)).toBeLessThan(0.5);
    // The three skirts add: the third peak sits 1.9 % above 2250 Hz at this Q.
    const peaks = peaksOf(response.tuned, A.hz);
    peaks.forEach((peak, k) => {
      expect(off(peak.hz, A.hz[k]!), `F${k + 1} at ${peak.hz} Hz`).toBeLessThan(0.02);
      const relative = peak.db - peaks[0]!.db;
      expect(Math.abs(relative - A.db[k]!), `A${k + 1} at ${relative} dB`).toBeLessThan(1.5);
    });
  });

  it('leaves the peaks where they are at MIDI 36 and 84 with key track 0', () => {
    const at60 = peaksOf(heard({ keyTrack: 0 }).tuned, A.hz);
    for (const note of [36, 84]) {
      const response = heard({ keyTrack: 0 }, note);
      expect(gapDb(response), `MIDI ${note}`).toBeLessThan(0.5);
      peaksOf(response.tuned, A.hz).forEach((peak, k) => {
        expect(peak.hz, `MIDI ${note} F${k + 1}`).toBe(at60[k]!.hz);
      });
    }
  });

  it('moves all three up an octave with envAmount 1 and the filter envelope at its peak', () => {
    const at = peaksOf(heard({}).tuned, A.hz);
    const response = heard({ envAmount: 1 });
    expect(gapDb(response)).toBeLessThan(0.5);
    peaksOf(
      response.tuned,
      A.hz.map((f) => 2 * f),
    ).forEach((peak, k) => {
      expect(off(peak.hz, 2 * at[k]!.hz), `F${k + 1} at ${peak.hz} Hz`).toBeLessThan(0.005);
    });
  });
});

describe('the vowel and the modulation (windsor#331)', () => {
  const tuned = (filter: Partial<FilterSettings>, note = 60, lane = 0, step = 0): number[] =>
    centres(hold(noisePatch(filter), 0.05, note, lane, step).voice);

  it('morphs between neighbours: vowel 0.5 puts F2 halfway between a and e', () => {
    const [f1, f2, f3] = tuned({ vowel: 0.5 });
    expect(f2).toBeCloseTo(1330, 9);
    expect(f1).toBeCloseTo(500, 9);
    expect(f3).toBeCloseTo(2325, 9);
  });

  it('plays u at 4 and clamps 4.5 to u and -1 to a', () => {
    const U = FORMANT_VOWELS[4]!.hz;
    expect(tuned({ vowel: 4 })).toEqual([...U]);
    expect(tuned({ vowel: 4.5 })).toEqual([...U]);
    expect(tuned({ vowel: -1 })).toEqual([...FORMANT_VOWELS[0]!.hz]);
  });

  it('moves the three together with the envelope and key track', () => {
    const a = FORMANT_VOWELS[0]!.hz.map((f) => 2 * f);
    const near = (got: number[]): void => got.forEach((f, k) => expect(f).toBeCloseTo(a[k]!, 6));
    near(tuned({ envAmount: 1 }));
    near(tuned({ keyTrack: 1 }, 72));
    expect(tuned({ keyTrack: 1 }, 48).map((f, k) => f / a[k]!)).toEqual([0.25, 0.25, 0.25]);
  });

  it('leaves the three alone under a cutoff lane or step, as the Cutoff knob does (windsor#419)', () => {
    const plain = tuned({});
    expect(tuned({}, 60, 1)).toEqual(plain);
    expect(tuned({}, 60, -2)).toEqual(plain);
    expect(tuned({}, 60, 0, 0.5)).toEqual(plain);
    expect(tuned({}, 60, 1, -0.5)).toEqual(plain);
  });

  it('is not heard in the other five modes: a vowel renders as none, to the bit', () => {
    for (const mode of [0, 1, 2, 3, 4]) {
      for (const slope24 of [false, true]) {
        const left = (filter: Partial<FilterSettings>): Float32Array =>
          hold(noisePatch({ mode, slope24, cutoff: 1200, resonance: 2, ...filter }), 0.3).left;
        const none = left({});
        expect(none.some((s) => s !== 0)).toBe(true);
        expect(sameBits(left({ vowel: 3.5 }), none), `mode ${mode}`).toBe(true);
      }
    }
  });

  it('retunes all three sections after a live switch to Lowpass and back to the same vowel', () => {
    const tuning = (voice: FormantVoice): number[][] =>
      sections(voice).map((s) => [s.a1, s.a2, s.a3, s.k, s.gain]);
    const fresh = tuning(hold(noisePatch({ vowel: 1.5, slope24: true }), 0.05).voice);
    const { processor, voice } = hold(noisePatch({ vowel: 1.5, slope24: true }), 0.05);
    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    const params = { ...PARAMS, voiceSlot0: new Float32Array([0]) };
    const edit = (filter: Partial<FilterSettings>): void => {
      processor.inbox({ type: 'patch', patch: noisePatch({ slope24: true, ...filter }) } as never);
      for (let b = 0; b < 4; b++) processor.process([], [out], params);
    };
    processor.inbox({ type: 'liveRetune', enabled: true } as never);
    edit({ mode: FILTER_MODE.LOWPASS, cutoff: 500, vowel: 1.5 });
    expect(tuning(voice)).not.toEqual(fresh);
    edit({ vowel: 1.5 });
    expect(tuning(voice)).toEqual(fresh);
  });

  it('ignores cutoff and slope24 in this mode, to the bit', () => {
    const left = (filter: Partial<FilterSettings>): Float32Array =>
      hold(noisePatch(filter), 0.5).left;
    const base = left({ cutoff: 100 });
    expect(sameBits(left({ cutoff: 18000 }), base)).toBe(true);
    expect(sameBits(left({ cutoff: 100, slope24: true }), base)).toBe(true);
  });
});

/**
 * One peak alone: a sine at its centre through a fresh copy of its section,
 * tuned as the voice tuned it, times its gain. The three sum in the voice,
 * where each one's skirt adds to its neighbours' peaks; alone, a peak's level
 * is the normalisation's.
 */
function peakLevel(voice: FormantVoice, k: number): number {
  const tuned = sections(voice)[k]!;
  const section = copyOf(tuned);
  const w = (2 * Math.PI * tuned.cutoffHz) / SR;
  let peak = 0;
  for (let i = 0; i < SR; i++) {
    const y = section.process(Math.sin(w * i), FILTER_MODE.BANDPASS);
    if (i > SR / 2) peak = Math.max(peak, Math.abs(y));
  }
  return peak * tuned.gain;
}

describe('the resonance (windsor#331)', () => {
  it('sets one Q for the three, resonance x 8, capped at 40', () => {
    expect(FORMANT_Q_PER_RESONANCE * 0.5).toBe(4);
    const settings: [number, number][] = [
      [0.5, 4],
      [0.707, 5.656],
      [5, 40],
      [12, FORMANT_Q_MAX],
    ];
    for (const [resonance, q] of settings) {
      const voice = hold(noisePatch({ resonance }), 0.05).voice;
      for (const s of sections(voice)) expect(s.q).toBeCloseTo(q, 9);
    }
  });

  it('keeps each peak at its table level from Q 4 to Q 40', () => {
    for (const vowel of [0, 2, 4]) {
      for (const resonance of [0.5, 0.707, 12]) {
        const voice = hold(noisePatch({ vowel, resonance }), 0.05).voice;
        for (let k = 0; k < 3; k++) {
          const level = db(peakLevel(voice, k) / FORMANT_MAKEUP);
          const want = FORMANT_VOWELS[vowel]!.db[k]!;
          expect(Math.abs(level - want), `vowel ${vowel}, r ${resonance}, A${k + 1}`).toBeLessThan(
            0.1,
          );
        }
      }
    }
  });
});

/** Blocks a voice of `patch` sounds for after its note-off, held 0.2 s first; `END_LIMIT` if it never ends. */
const END_LIMIT = 2000;
function blocksToEnd(patch: Patch): number {
  const { processor, voice } = hold(patch, 0.2);
  processor.inbox({ type: 'noteOff', id: 1, frame: 0 });
  const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const params = { ...PARAMS, voiceSlot0: new Float32Array([0]) };
  let blocks = 0;
  while (blocks < END_LIMIT && voice.active) {
    processor.process([], [out], params);
    blocks++;
  }
  return blocks;
}

describe('a Formant voice ending (windsor#331)', () => {
  it('ends after its release as a Bandpass voice does', () => {
    const release = (patch: Patch): Patch => {
      patch.ops[0]!.env.releaseTime = 0.05;
      return patch;
    };
    const formant = blocksToEnd(release(noisePatch({ resonance: 2 })));
    const bandpass = blocksToEnd(
      release(noisePatch({ mode: FILTER_MODE.BANDPASS, cutoff: 600, resonance: 2 })),
    );
    expect(formant).toBeGreaterThan((0.05 * SR) / BLOCK);
    expect(formant).toBeLessThan(END_LIMIT);
    expect(bandpass).toBeLessThan(END_LIMIT);
  });

  it('falls dormant once quiet, and stays awake while any of its three sections rings', () => {
    // A carrier that decays to a sustain of 0: the gated voice sleeps once its filter is quiet.
    const patch = noisePatch({});
    patch.ops[0]!.env = { ...patch.ops[0]!.env, decayTime: 0.01, sustainLevel: 0 };
    const { voice } = hold(patch, 0.5);
    expect(voice.dormant).toBe(true);
    for (const section of sections(voice)) {
      section.ic1 = 1e-3;
      expect(voice.dormant).toBe(false);
      section.ic1 = 0;
    }
    expect(voice.dormant).toBe(true);
  });
});
