/**
 * The Acid filter mode (windsor#573, record
 * `2026-10-04-acid-ladder-filter-mode`) through the shipped worklet: white
 * noise through the voice meets the analog TB-303 ladder's response
 * 1 / (D(s) + k HP(s)) at the bilinear image of the 2× solver's step rate,
 * through its resampling pair (windsor#593), times the output mix's
 * 1 + g HP_mix(s) (windsor#577) and the makeup (1 + k)^`LADDER_MAKEUP_POWER`
 * (windsor#587), in magnitude and phase, across the cutoff range and the
 * feedback; the envelope, key track and a
 * cutoff lane move its cutoff by the octaves they move the Lowpass mode's,
 * and its resonant peak with it; Slope and Vowel are not heard in it; and
 * an Acid voice ends after its release as any filtered voice does, the
 * ladder's ring included. The ladder alone is `worklet/fm/ladder.test.ts`
 * and `ladderLimits.test.ts`; that both render loops run it to the bit is
 * `fmProcessorKernel.test.ts`; that no factory preset changed is the
 * golden test.
 */
// reads-by-path: packages/engine/src/worklet/fm/**
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { oversampledLadderResponse } from '../__fixtures__/ladderAnalog';
import { peakNear, transfer } from '../__fixtures__/powerSpectrum';
import type { PowerSpectrum } from '../__fixtures__/powerSpectrum';
import { loadProcessor } from '../__fixtures__/workletHarness';
import type { ProcessorLike } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch } from '../patch/patch';
import type { FilterSettings, Patch } from '../patch/patch';
import {
  LADDER_CUTOFF_MAX_HZ,
  LADDER_FEEDBACK_HP_HZ,
  LADDER_FEEDBACK_MAX,
  LADDER_MAKEUP_POWER,
  LADDER_MIX_GAIN,
  LADDER_MIX_HP_HZ,
} from '../worklet/fm/fmConstants';
import { LADDER_DECIMATOR } from '../worklet/fm/ladderTables';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;
const ACID = FILTER_MODE.LADDER;

/** The worklet's ladder, as these tests read it. */
interface LadderLike {
  s1: number;
  hpS: number;
  mixS: number;
  k: number;
  mixGain: number;
  makeup: number;
  tunedHz: number;
}

interface AcidVoice {
  active: boolean;
  dormant: boolean;
  ladder: LadderLike;
  svfA: { cutoffHz: number };
}

const held = { attackTime: 0, decayTime: 0.01, sustainLevel: 1, peakLevel: 1 };

const PARAMS = {
  pitchBend: new Float32Array([0]),
  modWheel: new Float32Array([0]),
  gain: new Float32Array([1]),
};

/** The Reso knob's value for feedback `k`: p = k / LADDER_FEEDBACK_MAX on its log scale from 0.5 to 12. */
const resonanceFor = (k: number): number => 0.5 * 24 ** (k / LADDER_FEEDBACK_MAX);

/**
 * A lone held Noise carrier through `filter` at `volume`: white noise into
 * the ladder, small enough by default (±0.004 in its units) that the ladder
 * is linear.
 */
function noisePatch(filter: Partial<FilterSettings>, volume = 0.002): Patch {
  return makePatch({
    algorithm: 0,
    volume,
    ops: [{ wave: WAVE.NOISE, level: 1, velSens: 0, env: held }, {}, {}, {}],
    filter: { mode: ACID, env: makeEnvelope(held), ...filter },
  });
}

interface Held {
  processor: ProcessorLike;
  voice: AcidVoice;
  left: Float32Array;
}

/** One note held `seconds`, a song lane on the cutoff at `cutoffLane` octaves; the left channel. */
function hold(patch: Patch, seconds: number, note = 60, cutoffLane = 0): Held {
  const processor = loaded.create(patch, 1, undefined, { voiceSlots: ['filter.cutoff'] });
  const blocks = Math.ceil((seconds * SR) / BLOCK);
  const left = new Float32Array(blocks * BLOCK);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  const params = { ...PARAMS, voiceSlot0: new Float32Array([cutoffLane]) };
  loaded.setFrame(0);
  processor.inbox({ type: 'noteOn', id: 1, note, velocity: 1, frame: 0 });
  for (let b = 0; b < blocks; b++) {
    loaded.setFrame(b * BLOCK);
    processor.process([], [[outL, outR]], params);
    left.set(outL, b * BLOCK);
  }
  const voice = (processor.voices as unknown as AcidVoice[]).find((v) => v.active)!;
  return { processor, voice, left };
}

const SIZE = 8192;
const skip = (left: Float32Array): Float32Array => left.subarray(SR / 10);

/** White noise through `filter` on `note` for 4 s against the same noise with the filter Off. */
function heard(
  filter: Partial<FilterSettings>,
  note = 60,
  lane = 0,
): { response: PowerSpectrum; voice: AcidVoice } {
  const input = skip(hold(noisePatch({ ...filter, mode: FILTER_MODE.OFF }), 4, note).left);
  const { voice, left } = hold(noisePatch(filter), 4, note, lane);
  return { response: transfer(input, skip(left), SR, SIZE), voice };
}

const wrap = (degrees: number): number => ((((degrees + 180) % 360) + 360) % 360) - 180;
const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;

describe('the Acid mode through white noise (windsor#573)', () => {
  it('meets the analog ladder through the 2× pair with its output mix and makeup within 0.5 dB and 5°, 100 Hz to 2 f_c, f_c 500 Hz to past the top, k 0, 8 and 16', () => {
    // 18 kHz on the knob plays the top of the ladder's range.
    for (const cutoff of [500, 2000, 10000, 18000]) {
      for (const k of [0, 8, 16]) {
        const { response, voice } = heard({ cutoff, resonance: resonanceFor(k) });
        const fc = Math.min(cutoff, LADDER_CUTOFF_MAX_HZ);
        expect(voice.ladder.tunedHz).toBe(fc);
        expect(voice.ladder.k).toBeCloseTo(k, 9);
        // The mix's gain follows the same knob: LADDER_MIX_GAIN × p, p = k / LADDER_FEEDBACK_MAX.
        expect(voice.ladder.mixGain).toBeCloseTo((LADDER_MIX_GAIN * k) / LADDER_FEEDBACK_MAX, 9);
        const mix = { gain: voice.ladder.mixGain, hpHz: LADDER_MIX_HP_HZ };
        const loop = { cutoffHz: fc, k: voice.ladder.k, hpHz: LADDER_FEEDBACK_HP_HZ };
        // The makeup, the ladder's last gain (windsor#587): (1 + k)^power, 1 at k 0.
        expect(voice.ladder.makeup).toBeCloseTo((1 + voice.ladder.k) ** LADDER_MAKEUP_POWER, 12);
        const makeupDb = 20 * Math.log10(voice.ladder.makeup);
        const last = Math.floor(Math.min(2 * fc, 0.46 * SR) / response.binHz);
        for (let bin = Math.ceil(100 / response.binHz); bin <= last; bin++) {
          const hz = bin * response.binHz;
          const want = oversampledLadderResponse(hz, loop, mix, SR, LADDER_DECIMATOR);
          want.db += makeupDb;
          const db = 10 * Math.log10(response.power[bin]!);
          const degrees = (response.phase![bin]! * 180) / Math.PI;
          const label = `f_c ${cutoff}, k ${k}, ${hz.toFixed(0)} Hz`;
          expect(Math.abs(db - want.db), label).toBeLessThan(0.5);
          expect(Math.abs(wrap(degrees - want.degrees)), label).toBeLessThan(5);
        }
      }
    }
    // Twenty-four 4 s renders: about 2 s alone, past vitest's 5 s default beside the other worklet suites on a busy machine.
  }, 30_000);
});

/** The 2× chain's modelled response's peak, the output mix's included, between `lowHz` and `highHz`, on a 0.5 Hz grid. */
function analogPeakHz(ladder: LadderLike, fc: number, lowHz: number, highHz: number): number {
  let best = lowHz;
  let bestDb = -Infinity;
  const loop = { cutoffHz: fc, k: ladder.k, hpHz: LADDER_FEEDBACK_HP_HZ };
  const mix = { gain: ladder.mixGain, hpHz: LADDER_MIX_HP_HZ };
  for (let hz = lowHz; hz <= highHz; hz += 0.5) {
    const db = oversampledLadderResponse(hz, loop, mix, SR, LADDER_DECIMATOR).db;
    if (db > bestDb) [best, bestDb] = [hz, db];
  }
  return best;
}

describe('the modulation (windsor#573)', () => {
  const k16 = { cutoff: 1000, resonance: resonanceFor(16) };
  /** The cutoff a voice of the Lowpass mode tunes to under the same settings. */
  const lowpassCutoff = (filter: Partial<FilterSettings>, note: number, lane: number): number =>
    hold(noisePatch({ ...filter, mode: FILTER_MODE.LOWPASS }), 0.05, note, lane).voice.svfA
      .cutoffHz;

  it('moves the k 16 peak with the envelope, key track and a cutoff lane by the octaves they move the Lowpass cutoff', () => {
    const cases: [string, Partial<FilterSettings>, number, number][] = [
      ['none', {}, 60, 0],
      ['envAmount 1', { envAmount: 1 }, 60, 0],
      ['key track 1, an octave up', { keyTrack: 1 }, 72, 0],
      ['a cutoff lane, an octave up', {}, 60, 1],
    ];
    for (const [name, mod, note, lane] of cases) {
      const filter = { ...k16, ...mod };
      const { response, voice } = heard(filter, note, lane);
      const fc = voice.ladder.tunedHz;
      expect(fc, name).toBe(lowpassCutoff(filter, note, lane));
      expect(fc / 1000, name).toBeCloseTo(name === 'none' ? 1 : 2, 9);
      const want = analogPeakHz(voice.ladder, fc, 0.7 * fc, 1.6 * fc);
      const got = peakNear(response, 0.7 * fc, 1.6 * fc).hz;
      expect(Math.abs(got / want - 1), `${name}: ${got} Hz`).toBeLessThan(0.01);
    }
  });

  it('does not hear Slope or Vowel: slope24 and vowel 3 change no sample', () => {
    const left = (filter: Partial<FilterSettings>): Float32Array =>
      hold(noisePatch({ ...k16, ...filter }, 0.5), 0.5).left;
    const plain = left({});
    expect(plain.some((s) => s !== 0)).toBe(true);
    expect(sameBits(left({ slope24: true }), plain)).toBe(true);
    expect(sameBits(left({ vowel: 3 }), plain)).toBe(true);
    expect(sameBits(left({ slope24: true, vowel: 3 }), plain)).toBe(true);
  });
});

/** Blocks a voice of `patch` sounds for after its note-off, held 0.2 s first; `END_LIMIT` if it never ends. */
const END_LIMIT = 4000;
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

describe('the ladder on every platform (windsor#573)', () => {
  it('calls no Math tanh, exp, pow or tan, so the render is the same bits on arm64 and x64', () => {
    for (const file of ['ladder.ts', 'ladderTune.ts', 'voiceLadder.ts']) {
      const source = readFileSync(new URL(`../worklet/fm/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/Math\.(tanh|exp|pow|tan)\b/);
    }
  });
});

describe('an Acid voice ending (windsor#573)', () => {
  it('ends after its release, its resonant tail at k 17.2 and 200 Hz included, as a Lowpass voice does', () => {
    const release = (patch: Patch): Patch => {
      patch.ops[0]!.env.releaseTime = 0.05;
      return patch;
    };
    const acid = blocksToEnd(release(noisePatch({ cutoff: 200, resonance: 12 }, 0.5)));
    const lowpass = blocksToEnd(
      release(noisePatch({ mode: FILTER_MODE.LOWPASS, cutoff: 200, resonance: 12 }, 0.5)),
    );
    expect(acid).toBeGreaterThan((0.05 * SR) / BLOCK);
    expect(acid).toBeLessThan(END_LIMIT);
    expect(lowpass).toBeLessThan(END_LIMIT);
  });

  it('falls dormant once quiet, and stays awake while the ladder or either high-pass rings', () => {
    const patch = noisePatch({ cutoff: 400, resonance: 12 }, 0.5);
    patch.ops[0]!.env = { ...patch.ops[0]!.env, decayTime: 0.01, sustainLevel: 0 };
    const { voice } = hold(patch, 1);
    expect(voice.dormant).toBe(true);
    voice.ladder.s1 = 1e-3;
    expect(voice.dormant).toBe(false);
    voice.ladder.s1 = 0;
    voice.ladder.hpS = 1e-3;
    expect(voice.dormant).toBe(false);
    voice.ladder.hpS = 0;
    voice.ladder.mixS = 1e-3;
    expect(voice.dormant).toBe(false);
    voice.ladder.mixS = 0;
    expect(voice.dormant).toBe(true);
  });
});
