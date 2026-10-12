/**
 * The plate's low band and its live moves (windsor#748): `lowDecay` 1 costs
 * nothing and renders as if the band's code were not there; below and above
 * `lowCross` the band holds its two decay times; and HOLD, `lowDecay`, Size
 * and Decay move with a tail ringing without a step, judged as the Size-sweep
 * test in `reverbProcessor.test.ts` judges it (record
 * `2026-08-31-dattorro-reverb-not-plateau` §3): the largest sample-to-sample
 * step against a steady 220 Hz tone's own slew at the render's peak, times 3.
 */
import { describe, expect, it } from 'vitest';

import type { Automate, Feed } from '../__fixtures__/reverbHarness';
import {
  channel,
  impulseAt,
  internals,
  loadReverb,
  noiseBurst,
  octaveBand,
  renderReverb,
  t30,
} from '../__fixtures__/reverbHarness';

const loaded = loadReverb();
const BLOCK = 128;
const blockAt = (seconds: number): number => Math.round((seconds * loaded.sampleRate) / BLOCK);

describe('lowDecay 1', () => {
  it('renders bit for bit as the plate with no band code, and runs nothing of the band', () => {
    const automate: Automate = (block, values) => {
      values.size![0] = block < blockAt(0.6) ? 0.4 : 2;
      values.hold![0] = block > blockAt(1) && block < blockAt(1.4) ? 1 : 0;
      values.decay![0] = block < blockAt(1.6) ? 2 : 9;
    };
    const run = (lowBand: boolean): { samples: Float32Array; ran: boolean; state: number[] } => {
      let ran = false;
      let state: number[] = [];
      const { samples } = renderReverb(
        loaded,
        2.5,
        noiseBurst(0.3),
        {},
        {
          automate,
          create: { lowBand },
          collectSamples: true,
          afterBlock: (_, processor) => {
            const plate = internals(processor);
            ran ||= plate._band;
            state = [...plate._lowState];
          },
        },
      );
      return { samples, ran, state };
    };
    const band = run(true);
    const none = run(false);
    expect(Buffer.compare(Buffer.from(band.samples.buffer), Buffer.from(none.samples.buffer))).toBe(
      0,
    );
    expect(band.ran).toBe(false);
    expect(band.state.every((v) => v === 0)).toBe(true);
  });
});

/** The T30 of the octave band at `hz` for an impulse into the plate at `params`. */
function bandT30(params: Record<string, number>, hz: number): number {
  const settle = blockAt(0.5);
  const seconds = 1.5 * params['decay']! * Math.max(1, params['lowDecay']!) + 2;
  const { samples } = renderReverb(loaded, seconds, impulseAt(settle), params, {
    collectSamples: true,
  });
  const from = settle * BLOCK;
  return t30(octaveBand(channel(samples, 0, from), hz), octaveBand(channel(samples, 1, from), hz));
}

/** Damping open and modulation off: the conditions a band is measured in. */
const OPEN = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0 };

describe('the two bands', () => {
  /**
   * Three octaves either side of `lowCross`, as the Retro Reverb's own test
   * reads its band: a first-order split leaves a fifth of the difference in
   * log gain an octave away, so the research note's one-octave column misses
   * by more. Above, the band is held to the same band at `lowDecay` 1, since
   * the plate's own passes (the interpolating reads, the damping) shorten its
   * top whatever `lowDecay`.
   */
  it.each([0.25, 4])(
    'holds Decay × %f below lowCross and Decay above',
    (lowDecay) => {
      const params = { ...OPEN, size: 1, decay: 6, lowCross: 1000 };
      const low = bandT30({ ...params, lowDecay }, 125);
      expect(Math.abs(low / (params.decay * lowDecay) - 1)).toBeLessThan(0.15);
      const high = bandT30({ ...params, lowDecay }, 8000);
      const neutral = bandT30({ ...params, lowDecay: 1 }, 8000);
      expect(Math.abs(high / neutral - 1)).toBeLessThan(0.1);
    },
    120_000,
  );

  /**
   * Each band at its own target, three octaves from `lowCross`, within 15 %
   * (fix round 2 of PR windsor#750). The low band's gains take the measured
   * correction at its own target, Decay × `lowDecay`; with the broadband
   * factor times `lowDecay`, the first case's low band rang 39 s, 35 % short.
   * - Size 0.05, Decay 15, `lowDecay` 4: the low band asks 60 s, where the
   *   correction is 5.58 against Decay's 1.38. At Size 0.05 only about 250 Hz
   *   to 500 Hz rings past a minute even with every gain at 1 (the research
   *   note's ceilings), so the low band is read at 375 Hz, `lowCross` 3 kHz.
   *   Three octaves above that is past what a 36 ms tank rings at all, so the
   *   upper band is read at 640 Hz, `lowCross` 80 Hz.
   * - Size 4, Decay 4, `lowDecay` 0.25: the low band asks 1 s, under one trip
   *   round the tank (2.9 s), from the correction's short end.
   */
  it.each([
    { size: 0.05, decay: 15, lowDecay: 4, lowCross: 3000, hz: 375, target: 60 },
    { size: 0.05, decay: 15, lowDecay: 4, lowCross: 80, hz: 640, target: 15 },
    { size: 4, decay: 4, lowDecay: 0.25, lowCross: 250, hz: 31.25, target: 1 },
    { size: 4, decay: 4, lowDecay: 0.25, lowCross: 250, hz: 2000, target: 4 },
  ])(
    'holds its own target: $hz Hz at Size $size, Decay $decay × $lowDecay, lowCross $lowCross',
    ({ hz, target, ...space }) => {
      const measured = bandT30({ ...OPEN, ...space }, hz);
      expect(Math.abs(measured / target - 1)).toBeLessThan(0.15);
    },
    120_000,
  );

  /**
   * With the all-passes moving, the low band's gains are cut for the same
   * shortened length as the broadband gains (`tankGains.ts`): each moving
   * line, less its excursion (fix round 2 of PR windsor#767). Cut for the
   * full length, this band rang 32.7 s of its 40 (−18 %); cut for the
   * shortened one, 34.8 s (−13 %). The denser output taps (windsor#766) read
   * the 36 ms tank at other points and measure it 33.9 s (−15.4 %), so this
   * corner is held to 16 % (record `2026-10-12-plate-output-taps`).
   */
  it('holds its own target with modulation on: 375 Hz at Size 0.05, Decay 10 × 4, 8 Hz, 4 ms', () => {
    const space = { size: 0.05, decay: 10, lowDecay: 4, lowCross: 3000, modRate: 8, modDepth: 4 };
    const measured = bandT30({ ...OPEN, ...space }, 375);
    expect(Math.abs(measured / 40 - 1)).toBeLessThan(0.16);
  }, 120_000);
});

describe('the sample loop (worklet rule 6)', () => {
  /**
   * The low band's shelf is written out at each of the tank's eight gain
   * points, never called: read off the shipped bundle, the sample loop calls
   * only the plate's own line methods (#671's exception) and `Math`. The
   * output taps' reads are written out too since windsor#766, so `_readTap`
   * is gone.
   */
  it('calls no helper per sample', () => {
    const prototype = Object.getPrototypeOf(loaded.create()) as { _renderBlock: unknown };
    const render = String(prototype._renderBlock);
    const start = render.indexOf('for (let i = 0; i < 128; i++) {');
    const end = render.indexOf('this._preDelayWrite = (', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const loop = render.slice(start, end);
    const calls = new Set(
      [...loop.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)]
        .map((match) => match[1]!)
        .filter((name) => !['for', 'if', 'while'].includes(name)),
    );
    expect([...calls].sort()).toEqual([
      'Math.abs',
      'Math.floor',
      'Math.max',
      'this._read',
      'this._readCubic',
      'this._write1',
    ]);
    // The band runs in the loop: each point writes its lowpass's state there.
    for (let p = 0; p < 8; p++) expect(loop).toContain(`lowState[${p}] = low + delta`);
  });
});

const TONE_HZ = 220;

/** A steady 220 Hz tone at 0.3, the signal a step is judged against. */
const tone: Feed = (block, left, right) => {
  for (let i = 0; i < left.length; i++) {
    const t = (block * BLOCK + i) / loaded.sampleRate;
    left[i] = right[i] = Math.sin(2 * Math.PI * TONE_HZ * t) * 0.3;
  }
};

/** One sample of the tone's slew at the render's peak, with headroom for the plate's texture. */
function expectNoStep(seconds: number, params: Record<string, number>, automate: Automate): void {
  const result = renderReverb(loaded, seconds, tone, params, automate);
  expect(result.nonFinite).toBe(0);
  const ceiling = ((2 * Math.PI * TONE_HZ) / loaded.sampleRate) * result.peak * 3;
  expect(result.maxStep).toBeLessThan(ceiling);
}

/** `field` at `moved` from `from` seconds until `until`, and `rest` either side. */
const between =
  (field: string, from: number, until: number, rest: number, moved: number): Automate =>
  (block, values) => {
    values[field]![0] = block >= blockAt(from) && block < blockAt(until) ? moved : rest;
  };

describe('moves with a tail ringing', () => {
  it.each([0.25, 4])('HOLD on and off at lowDecay %f', (lowDecay) => {
    expectNoStep(6, { lowDecay }, between('hold', 2, 4, 0, 1));
  });

  it.each([0.25, 4])('lowDecay from 1 to %f and back', (lowDecay) => {
    expectNoStep(6, {}, between('lowDecay', 2, 4, 1, lowDecay));
  });

  it.each([
    [0.2, 60],
    [60, 0.2],
  ])('Decay stepped from %f to %f and back', (rest, moved) => {
    expectNoStep(6, { decay: rest, lowDecay: 4 }, between('decay', 2, 4, rest, moved));
  });

  /**
   * Over 8 s each way. Faster, the sweep's Doppler, compounding round the
   * tank, lifts a long tail's pitch past what a 220 Hz ceiling allows, on
   * the plate before windsor#748 too: the research note has the figures.
   */
  it.each([1, 0.25, 4])(
    'Size from 0.05 to 4 and back at lowDecay %f',
    (lowDecay) => {
      const span = 8;
      const size = (block: number): number => {
        const t = (block * BLOCK) / loaded.sampleRate - 1;
        const at = Math.min(Math.max(t, 0), 2 * span);
        return 0.05 + (3.95 * (at < span ? at : 2 * span - at)) / span;
      };
      expectNoStep(2 * span + 2, { size: 0.05, lowDecay }, (block, values) => {
        values.size![0] = size(block);
      });
    },
    60_000,
  );
});
