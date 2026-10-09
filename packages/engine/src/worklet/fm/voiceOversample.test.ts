/**
 * The synced voice's decimator and its choice (windsor#656, record
 * `2026-10-09-sync-voice-at-2x`): the drive oversampler's FIR, shared and
 * not restated, its 16 samples of delay at the part's rate, unity at DC, the
 * same output whatever the render calls' lengths, and which patches run at
 * twice the rate. The render is `synth/fmProcessorOversample.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { makePatch } from '../../patch/patch';
import type { PartialOperator, Patch } from '../../patch/patch';
import { DRIVE_OVERSAMPLE_FIR } from '../advancedDrive/driveOversample';
import { DORMANT_AMP, SYNC_OVERSAMPLE } from './fmConstants';
import { WAVE } from './waveIds';

// `waveTables` (through the render) warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { OVERSAMPLE_HALF, VoiceOversample, decimateVoiceSums, oversampleQuiet, patchOversamples } =
  await import('./voiceOversample');

/** `x`, at the doubled rate, through a fresh decimator in calls of `chunks` outputs each, in turn (a quantum's by default). */
function decimated(x: Float64Array, chunks: number[] = [128]): Float64Array {
  const os = new VoiceOversample();
  os.factor = SYNC_OVERSAMPLE;
  const out = new Float64Array(x.length / SYNC_OVERSAMPLE);
  let from = 0;
  for (let c = 0; from < out.length; c++) {
    const n = Math.min(chunks[c % chunks.length]!, out.length - from);
    os.sums.set(x.subarray(SYNC_OVERSAMPLE * from, SYNC_OVERSAMPLE * (from + n)));
    decimateVoiceSums(os, n);
    out.set(os.sums.subarray(0, n), from);
    from += n;
  }
  return out;
}

describe('decimateVoiceSums', () => {
  it('is the drive oversampler’s FIR, its 65 taps at the doubled rate, centred 16 samples late', () => {
    const impulse = new Float64Array(256);
    impulse[0] = 1;
    const y = decimated(impulse);
    const h = DRIVE_OVERSAMPLE_FIR;
    expect(h).toHaveLength(65);
    expect(OVERSAMPLE_HALF / SYNC_OVERSAMPLE).toBe(16);
    // Output s sees the impulse 2s inputs back: the even taps, folded about the centre.
    for (let s = 0; s <= OVERSAMPLE_HALF / SYNC_OVERSAMPLE; s++) {
      expect(y[s]).toBeCloseTo(h[SYNC_OVERSAMPLE * s]!, 15);
      expect(y[OVERSAMPLE_HALF - s]).toBeCloseTo(h[SYNC_OVERSAMPLE * s]!, 15);
    }
    expect(y.indexOf(Math.max(...y))).toBe(16);
    expect(y.subarray(OVERSAMPLE_HALF + 1).every((v) => v === 0)).toBe(true);
  });

  it('passes DC at unity and a 1 kHz sine 16 samples late at its level', () => {
    const dc = decimated(new Float64Array(512).fill(0.5));
    expect(dc[200]).toBeCloseTo(0.5, 12);
    const rate = 96000;
    const sine = new Float64Array(4096).map((_, k) => Math.sin((2 * Math.PI * 1000 * k) / rate));
    const y = decimated(sine);
    for (let s = 100; s < y.length; s++) {
      expect(y[s]).toBeCloseTo(Math.sin((2 * Math.PI * 1000 * (s - 16)) / 48000), 4);
    }
  });

  it('gives the same output to the bit in render calls of any length', () => {
    const x = new Float64Array(2048).map((_, k) => Math.sin(k * 0.37) + 0.3 * Math.sin(k * 2.1));
    const whole = decimated(x, [128]);
    for (const chunks of [[32], [1, 7, 128, 13], [100, 28]]) {
      expect(decimated(x, chunks)).toEqual(whole);
    }
  });

  it('is quiet once its line holds nothing over the dormancy floor, and always at 1×', () => {
    const os = new VoiceOversample();
    expect(oversampleQuiet(os)).toBe(true);
    os.factor = SYNC_OVERSAMPLE;
    os.sums[0] = 10 * DORMANT_AMP;
    decimateVoiceSums(os, 1);
    expect(oversampleQuiet(os)).toBe(false);
    os.sums.fill(0);
    decimateVoiceSums(os, 33);
    expect(oversampleQuiet(os)).toBe(true);
  });
});

describe('patchOversamples', () => {
  const patch = (a: PartialOperator, b: PartialOperator = {}): Patch =>
    makePatch({ ops: [a, b, {}, {}] });

  it('is a patch with a synced operator, none fed and none Noise', () => {
    expect(patchOversamples(patch({ sync: 'note' }))).toBe(true);
    expect(patchOversamples(patch({}, { sync: 'A' }))).toBe(true);
    expect(patchOversamples(patch({}))).toBe(false);
    expect(patchOversamples(patch({ sync: 'note' }, { feedback: -0.2 }))).toBe(false);
    expect(patchOversamples(patch({ sync: 'note' }, { wave: WAVE.NOISE }))).toBe(false);
  });
});
