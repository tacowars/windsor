/**
 * The SVF's 24 dB mode through the shipped worklet (windsor#595): two
 * sections in series, only the first resonant, so the lowpass peaks near
 * Reso / sqrt 2 rather than Reso squared while the slope stays 24 dB an
 * octave; and a Reso swept live across its whole range stays finite. The
 * response is read off fresh copies of the sections the voice was tuned to,
 * as the Formant test reads its peaks. That the 12 dB, Formant and Acid
 * modes did not move is the golden test.
 */
import { describe, expect, it } from 'vitest';

import { peakNear, responseOf } from '../__fixtures__/powerSpectrum';
import type { PowerSpectrum } from '../__fixtures__/powerSpectrum';
import { loadProcessor } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch } from '../patch/patch';
import type { Patch } from '../patch/patch';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;
const SIZE = 16384;
const CUTOFF = 500;
const LP = FILTER_MODE.LOWPASS;

/** The worklet's filter section, as this test reads it. */
interface SectionLike {
  k: number;
  a1: number;
  a2: number;
  a3: number;
  process(v0: number, mode: number): number;
}

interface Slope24Voice {
  active: boolean;
  svfA: SectionLike;
  svfB: SectionLike;
}

const held = { attackTime: 0, decayTime: 0.01, sustainLevel: 1, peakLevel: 1 };

const PARAMS = {
  pitchBend: new Float32Array([0]),
  modWheel: new Float32Array([0]),
  gain: new Float32Array([1]),
};

/** A lone held Noise carrier through a 24 dB lowpass at `resonance`. */
function noisePatch(resonance: number): Patch {
  return makePatch({
    algorithm: 0,
    volume: 0.5,
    ops: [{ wave: WAVE.NOISE, level: 1, velSens: 0, env: held }, {}, {}, {}],
    filter: { mode: LP, slope24: true, cutoff: CUTOFF, resonance, env: makeEnvelope(held) },
  });
}

/**
 * One note on `patch` for `blocks`, a resonance lane at `lane(b)` offset in
 * block `b`; the voice and the number of non-finite samples.
 */
function hold(
  patch: Patch,
  blocks: number,
  lane: (b: number) => number = () => 0,
): { voice: Slope24Voice; nonFinite: number } {
  const processor = loaded.create(patch, 1, undefined, { voiceSlots: ['filter.resonance'] });
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  const slot = new Float32Array([0]);
  const params = { ...PARAMS, voiceSlot0: slot };
  let nonFinite = 0;
  loaded.setFrame(0);
  processor.inbox({ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 });
  for (let b = 0; b < blocks; b++) {
    slot[0] = lane(b);
    loaded.setFrame(b * BLOCK);
    processor.process([], [[outL, outR]], params);
    for (let i = 0; i < BLOCK; i++) {
      if (!Number.isFinite(outL[i]!) || !Number.isFinite(outR[i]!)) nonFinite++;
    }
  }
  const voice = (processor.voices as unknown as Slope24Voice[]).find((v) => v.active)!;
  return { voice, nonFinite };
}

/** A fresh section of the bundle's, tuned as `tuned` is and at rest. */
function copyOf(tuned: SectionLike): SectionLike {
  const section = new (tuned.constructor as new () => SectionLike)();
  Object.assign(section, { a1: tuned.a1, a2: tuned.a2, a3: tuned.a3, k: tuned.k });
  return section;
}

/** The 24 dB lowpass the voice was tuned to at `resonance`: an impulse through both sections. */
function tunedResponse(resonance: number): PowerSpectrum {
  const { voice } = hold(noisePatch(resonance), 4);
  const a = copyOf(voice.svfA);
  const b = copyOf(voice.svfB);
  const h = Float64Array.from({ length: SIZE }, (_, i) =>
    b.process(a.process(i === 0 ? 1 : 0, LP), LP),
  );
  return responseOf(h, SR, SIZE);
}

const dbAt = (response: PowerSpectrum, hz: number): number =>
  10 * Math.log10(response.power[Math.round(hz / response.binHz)]!);

describe('the 24 dB mode has one resonant section (windsor#595)', () => {
  it.each([4, 12])('peaks within 1 dB of Reso / sqrt 2 at Reso %d', (resonance) => {
    const peak = peakNear(tunedResponse(resonance), CUTOFF * 0.8, CUTOFF * 1.2);
    expect(Math.abs(peak.hz / CUTOFF - 1), `peak at ${peak.hz} Hz`).toBeLessThan(0.05);
    expect(Math.abs(peak.db - 20 * Math.log10(resonance / Math.SQRT2))).toBeLessThan(1);
  });

  it.each([0.707, 12])(
    'falls about 24 dB an octave well above the cutoff at Reso %d',
    (resonance) => {
      const response = tunedResponse(resonance);
      const octave = dbAt(response, 4 * CUTOFF) - dbAt(response, 8 * CUTOFF);
      expect(octave).toBeGreaterThan(22);
      expect(octave).toBeLessThan(26);
    },
  );

  it('stays finite with the Reso swept live from 0.5 to 12', () => {
    const blocks = Math.ceil((2 * SR) / BLOCK);
    const { nonFinite } = hold(noisePatch(0.5), blocks, (b) => (11.5 * b) / (blocks - 1));
    expect(nonFinite).toBe(0);
  });
});
