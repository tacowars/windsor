/**
 * The plate's tank modulation against `main`'s (windsor#764): at the new
 * default a steady 1 kHz sine's wet spectrum spreads less than at `main`'s
 * default, and the same sine held under HOLD beats less. Both are read as
 * `docs/research/2026-10-12-plate-modulation/`'s `rig.mjs` reads them, which
 * tables them over the whole of `modRate` and `modDepth` beside `main`'s.
 */
import { describe, expect, it } from 'vitest';

import type { Automate, Feed } from '../__fixtures__/reverbHarness';
import { channel, loadReverb, renderReverb } from '../__fixtures__/reverbHarness';
import { DEFAULT_SPACE } from './reverbSpace';

const loaded = loadReverb();
const SR = loaded.sampleRate;
const BLOCK = 128;
const blockAt = (seconds: number): number => Math.round((seconds * SR) / BLOCK);
const DEFAULTS = { modRate: DEFAULT_SPACE.modRate, modDepth: DEFAULT_SPACE.modDepth };

/**
 * `main` at ca06820, before this change, at its defaults (0.5 Hz, 0.7 ms),
 * read by `spreadHz` and `heldBeat` below: the RMS width of a 1 kHz sine's
 * wet spectrum within ±250 Hz, and the strongest 0.1 to 10 Hz component of
 * that sine's envelope held under HOLD for 30 s, re its mean.
 */
const MAIN_SPREAD_HZ = 2.12;
const MAIN_HELD_BEAT_DB = -18.5;

/** In-place radix-2 FFT over `re` and `im`, whose length is a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos((-2 * Math.PI * k) / size);
        const wi = Math.sin((-2 * Math.PI * k) / size);
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * wr - im[b]! * wi;
        const ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

/** Welch: the power in each bin of `x` (minus `mean`), Hann segments of `size`, half overlapped. */
function welch(x: ArrayLike<number>, size: number, mean = 0): Float64Array {
  const power = new Float64Array(size / 2);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let from = 0; from + size <= x.length; from += size / 2) {
    for (let i = 0; i < size; i++) {
      re[i] = (x[from + i]! - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k] = power[k]! + re[k]! ** 2 + im[k]! ** 2;
  }
  return power;
}

/** A sine at 0.3 on both sides, until `until` seconds. */
const sine =
  (hz: number, until = Infinity): Feed =>
  (block, left, right) => {
    for (let i = 0; i < BLOCK; i++) {
      const at = block * BLOCK + i;
      if (at >= until * SR) return;
      left[i] = right[i] = Math.sin((2 * Math.PI * hz * at) / SR) * 0.3;
    }
  };

/** The RMS width in Hz of the wet's spectrum within ±250 Hz of a steady 1 kHz sine, from 4 s to 12 s. */
function spreadHz(params: Record<string, number>): number {
  const { samples } = renderReverb(loaded, 12, sine(1000), params, { collectSamples: true });
  const size = 32768;
  const power = welch(channel(samples, 0, 4 * SR), size);
  let sum = 0;
  let moment = 0;
  for (let k = 0; k < power.length; k++) {
    const offset = (k * SR) / size - 1000;
    if (Math.abs(offset) > 250) continue;
    sum += power[k]!;
    moment += power[k]! * offset ** 2;
  }
  return Math.sqrt(moment / sum);
}

/**
 * A 1 kHz sine held under HOLD from 1.9 s: the strongest component between
 * 0.1 and 10 Hz of its wet envelope (RMS over 10 ms) from 3 s to 33 s, in dB
 * re the envelope's mean, Welch over 10 s segments, the louder side.
 */
function heldBeat(params: Record<string, number>): number {
  const hold: Automate = (block, values) => (values.hold![0] = block >= blockAt(1.9) ? 1 : 0);
  const { samples } = renderReverb(loaded, 33.5, sine(1000, 2), params, {
    automate: hold,
    collectSamples: true,
  });
  const window = SR / 100;
  return Math.max(
    ...([0, 1] as const).map((side) => {
      const wet = channel(samples, side, 3 * SR);
      const envelope = new Float64Array(30 * 100);
      for (let w = 0; w < envelope.length; w++) {
        let energy = 0;
        for (let i = 0; i < window; i++) energy += wet[w * window + i]! ** 2;
        envelope[w] = Math.sqrt(energy / window);
      }
      const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
      const segment = 1000;
      const size = 1024;
      const power = new Float64Array(size / 2);
      let count = 0;
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      let gain = 0;
      for (let i = 0; i < segment; i++)
        gain += 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (segment - 1));
      for (let from = 0; from + segment <= envelope.length; from += segment / 2) {
        re.fill(0);
        im.fill(0);
        for (let i = 0; i < segment; i++) {
          re[i] =
            (envelope[from + i]! - mean) *
            (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (segment - 1)));
        }
        fft(re, im);
        for (let k = 0; k < size / 2; k++) power[k] = power[k]! + re[k]! ** 2 + im[k]! ** 2;
        count++;
      }
      let strongest = 0;
      for (let k = 1; k < size / 2; k++) {
        const hz = (k * 100) / size;
        if (hz < 0.1 || hz > 10) continue;
        strongest = Math.max(strongest, (2 * Math.sqrt(power[k]! / count)) / gain);
      }
      return 20 * Math.log10(strongest / mean);
    }),
  );
}

describe('lighter than main', () => {
  it(
    'spreads a 1 kHz sine less at the default than main did at its own',
    () => expect(spreadHz(DEFAULTS)).toBeLessThan(MAIN_SPREAD_HZ),
    60_000,
  );

  it(
    'beats less on a 1 kHz sine held under HOLD at the default than main did at its own',
    () => expect(heldBeat(DEFAULTS)).toBeLessThan(MAIN_HELD_BEAT_DB),
    60_000,
  );
});
