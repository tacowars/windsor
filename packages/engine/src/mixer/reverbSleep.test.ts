/**
 * The plate's sleep and its settled-SIZE bookkeeping skip (#547): two savings
 * that must not change a sample anyone could hear. Every "before" is the same
 * plate built with the saving switched off (`sleep: false`, `settledSkip:
 * false`) and rendered in the same test; the sleep span is derived from the
 * worklet's own topology constants, never a literal.
 */
import { describe, expect, it } from 'vitest';

import type { Automate, Feed, ReverbProcessorLike } from '../__fixtures__/reverbHarness';
import { impulse, internals, loadReverb, renderReverb } from '../__fixtures__/reverbHarness';

const loaded = loadReverb();
const SR = loaded.sampleRate;
const BLOCK = 128;
const { topology } = loaded;

/** −120 dB, as an amplitude ratio. */
const RESIDUAL_RATIO = 1e-6;
/**
 * The plate these renders use, named here rather than taken from the descriptor
 * defaults so tuning a default cannot starve a render of its sleep.
 */
const PLATE = { decay: 0.5 };
/**
 * A cap, not a deadline: well past the time PLATE's tail takes to fall under the
 * floor and sleep. Where sleep actually lands is observed, never assumed.
 */
const RENDER_S = 30;
const COMPARE_S = 0.5;

const blockAt = (seconds: number): number => Math.round((seconds * SR) / BLOCK);

/** The recirculation span: the longest tank line at MAX_SIZE plus the longest pre-delay. */
const recirculationSamples = (): number =>
  (Math.max(...topology.tankDelays) * topology.maxSize + topology.maxPreDelay) * SR;

/** Records the first block after which the plate reports asleep, or -1. */
const sleepWatch = (): {
  firstAsleep: () => number;
  afterBlock: (b: number, p: ReverbProcessorLike) => void;
} => {
  let first = -1;
  return {
    firstAsleep: () => first,
    afterBlock: (b, p) => {
      if (first < 0 && internals(p)._asleep) first = b;
    },
  };
};

const blockPeak = (samples: Float32Array, block: number): number => {
  let peak = 0;
  for (let i = block * BLOCK * 2; i < (block + 1) * BLOCK * 2; i++) {
    peak = Math.max(peak, Math.abs(samples[i] ?? 0));
  }
  return peak;
};

describe('sleep', () => {
  it('enters after the recirculation span of silence, and changes nothing audible', () => {
    const watch = sleepWatch();
    const sleeping = renderReverb(loaded, RENDER_S, impulse, PLATE, {
      collectSamples: true,
      afterBlock: watch.afterBlock,
    });
    const never = renderReverb(loaded, RENDER_S, impulse, PLATE, {
      collectSamples: true,
      create: { sleep: false },
    });
    const asleepFrom = watch.firstAsleep();
    expect(asleepFrom).toBeGreaterThan(0);

    // The span covers the longest recirculation, and sleep waits for all of it
    // after the last block the tail was above the floor (wet is 1 here, so the
    // output is the tap sum the plate measures).
    const span = internals(loaded.create())._sleepSpan;
    expect(span).toBeGreaterThanOrEqual(recirculationSamples());
    let lastLoud = 0;
    for (let b = 0; b < asleepFrom; b++) {
      if (blockPeak(never.samples, b) > topology.sleepOutputFloor) lastLoud = b;
    }
    expect((asleepFrom - lastLoud) * BLOCK).toBeGreaterThan(span);
    expect((asleepFrom - lastLoud - 2) * BLOCK).toBeLessThanOrEqual(span);

    const sleepSample = (asleepFrom + 1) * BLOCK * 2;
    let residual = 0;
    for (let i = 0; i < sleepSample; i++) {
      residual = Math.max(residual, Math.abs((sleeping.samples[i] ?? 0) - (never.samples[i] ?? 0)));
    }
    expect(residual).toBeLessThanOrEqual(never.peak * RESIDUAL_RATIO);
    expect(sleeping.samples.subarray(sleepSample).every((s) => s === 0)).toBe(true);
    // What the never-sleeping plate still had there was under the floor.
    let skipped = 0;
    for (let i = sleepSample; i < never.samples.length; i++) {
      skipped = Math.max(skipped, Math.abs(never.samples[i] ?? 0));
    }
    expect(skipped).toBeLessThanOrEqual(topology.sleepOutputFloor);
  });

  it('wakes on the next sound and renders it exactly as a fresh plate would', () => {
    // Where a lone impulse's plate falls asleep, observed; the second lands after it.
    const probe = sleepWatch();
    renderReverb(loaded, RENDER_S, impulse, PLATE, { afterBlock: probe.afterBlock });
    expect(probe.firstAsleep()).toBeGreaterThan(0);
    const second = probe.firstAsleep() + 1;

    const twice: Feed = (block, left, right) => {
      if (block !== 0 && block !== second) return;
      left[0] = 1;
      right[0] = 1;
    };
    const watch = sleepWatch();
    const woken = renderReverb(loaded, (second * BLOCK) / SR + COMPARE_S, twice, PLATE, {
      collectSamples: true,
      afterBlock: watch.afterBlock,
    });
    const fresh = renderReverb(loaded, COMPARE_S, impulse, PLATE, { collectSamples: true });

    expect(watch.firstAsleep()).toBe(probe.firstAsleep());
    const after = woken.samples.subarray(second * BLOCK * 2);
    expect(fresh.peak).toBeGreaterThan(0);
    expect(after).toEqual(fresh.samples);
  });

  it('never sleeps under HOLD, whose frozen tank is the sound', () => {
    const watch = sleepWatch();
    const held = renderReverb(
      loaded,
      RENDER_S,
      impulse,
      { hold: 1 },
      {
        afterBlock: watch.afterBlock,
      },
    );
    expect(watch.firstAsleep()).toBe(-1);
    expect(held.trace.at(-1)).toBeGreaterThan(topology.sleepOutputFloor);
  });

  it('never sleeps under HOLD on silence either', () => {
    const watch = sleepWatch();
    renderReverb(loaded, RENDER_S, () => {}, { hold: 1 }, { afterBlock: watch.afterBlock });
    expect(watch.firstAsleep()).toBe(-1);
  });

  it('does not sleep through a tail it holds at wet 0', () => {
    // The tail rings at wet 0 and is turned up after what would be the span.
    const upAt = blockAt(1.8);
    const wetUp: Automate = (block, values) => {
      values.wet![0] = block < upAt ? 0 : 1;
    };
    const opts = { collectSamples: true, automate: wetUp };
    const sleeping = renderReverb(loaded, 3, impulse, {}, opts);
    const never = renderReverb(loaded, 3, impulse, {}, { ...opts, create: { sleep: false } });
    expect(sleeping.peak).toBeGreaterThan(0);
    expect(sleeping.samples).toEqual(never.samples);
  });
});

describe('settled SIZE', () => {
  it('skips the length and tap bookkeeping without changing a sample while SIZE glides', () => {
    // Still, then a glide, then still again: both branches of the skip in one render.
    const glide: Automate = (block, values) => {
      values.size![0] = block < blockAt(0.5) ? 1 : block < blockAt(1) ? 2.5 : 0.6;
    };
    const feed: Feed = (block, left, right) => {
      if (block % blockAt(0.3) !== 0) return;
      // Same sign on both channels: the plate sums its input to mono, so
      // opposite signs would cancel and leave the tank silent.
      left[0] = 1;
      right[0] = 1;
    };
    let settledBlocks = 0;
    let glidingBlocks = 0;
    const afterBlock = (_b: number, p: ReverbProcessorLike) => {
      if (internals(p)._stepping) glidingBlocks++;
      else settledBlocks++;
    };
    const opts = { collectSamples: true, automate: glide };
    const skipping = renderReverb(loaded, 2, feed, {}, { ...opts, afterBlock });
    // The skip really skipped: settled blocks ran without the bookkeeping.
    expect(settledBlocks).toBeGreaterThan(0);
    expect(glidingBlocks).toBeGreaterThan(0);
    const always = renderReverb(loaded, 2, feed, {}, { ...opts, create: { settledSkip: false } });
    // The feed excites the tank: a cancelling feed renders below the sleep floor.
    expect(skipping.peak).toBeGreaterThan(topology.sleepOutputFloor);
    expect(skipping.samples).toEqual(always.samples);
  });
});
