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
      const params = {
        size: 1,
        decay: 6,
        lowCross: 1000,
        tankLowCut: 10,
        tankHighCut: 20000,
        modDepth: 0,
      };
      const settle = blockAt(0.5);
      const band = (p: Record<string, number>, hz: number): number => {
        const seconds = 1.5 * p['decay']! * Math.max(1, p['lowDecay']!) + 2;
        const { samples } = renderReverb(loaded, seconds, impulseAt(settle), p, {
          collectSamples: true,
        });
        const from = settle * BLOCK;
        return t30(
          octaveBand(channel(samples, 0, from), hz),
          octaveBand(channel(samples, 1, from), hz),
        );
      };
      const low = band({ ...params, lowDecay }, 125);
      expect(Math.abs(low / (params.decay * lowDecay) - 1)).toBeLessThan(0.15);
      const high = band({ ...params, lowDecay }, 8000);
      const neutral = band({ ...params, lowDecay: 1 }, 8000);
      expect(Math.abs(high / neutral - 1)).toBeLessThan(0.1);
    },
    120_000,
  );
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
