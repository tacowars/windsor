/**
 * Spectre's sleep (record `2026-10-16-spectre-insert`, windsor#793): after a
 * burst and silence it sleeps once no frame has written above the floor for
 * the memory's length and the modulations' own; asleep it renders what a
 * Spectre that never sleeps renders, within the floors; a frozen memory that
 * still holds the burst never sleeps; and a loud block wakes it, heard at
 * once.
 */
import { describe, expect, it } from 'vitest';
import {
  loadSpectre,
  runSpectre,
  setSpectre,
  spectreFlat,
  spectreParams,
  spectreSignal,
} from '../__fixtures__/spectreHarness';
import { DEFAULT_SPECTRE } from './spectreSpec';
import type { SpectreSpec } from './spectreSpec';

const RATE = 48000;
/** Repeats that fall fast, so the tail is mostly the 8 s reach. */
const spec: Partial<SpectreSpec> = {
  sync: false,
  timeMs: 400,
  mix: 1,
  curves: { ...DEFAULT_SPECTRE.curves, feedback: spectreFlat(0.2) },
};

const burstThenSilence = (seconds: number, wakeAt = Infinity) =>
  spectreSignal(seconds * RATE, (i) =>
    i < 4800 || (i >= wakeAt && i < wakeAt + 4800) ? 0.5 * Math.sin(i * 0.07) : 0,
  );

describe('Spectre asleep', () => {
  it('sleeps after its tail, matching a Spectre that never sleeps, and wakes on a loud block', () => {
    const params = spectreParams(spec);
    const sleeper = loadSpectre(RATE, params);
    const awake = loadSpectre(RATE, spectreParams(spec), { sleep: false });
    // The tail: the repeats' fall to the floor, then the 8 s any delay can reach.
    const wakeAt = 14 * RATE;
    const input = burstThenSilence(15, wakeAt);
    let sleptAt = -1;
    const slept = runSpectre(sleeper, input, params, (q) => {
      if (sleptAt < 0 && sleeper.dsp.asleep) sleptAt = q * 128;
    });
    const never = runSpectre(awake, input, spectreParams(spec));
    expect(sleptAt).toBeGreaterThan(0);
    expect(sleptAt).toBeLessThan(wakeAt);
    expect(sleeper.dsp.asleep).toBe(false);
    let most = 0;
    for (let i = 0; i < slept.left.length; i++)
      most = Math.max(most, Math.abs(slept.left[i]! - never.left[i]!));
    expect(most).toBeLessThan(1e-6);
    // The second burst was heard: the processor woke on its block.
    let after = 0;
    for (let i = wakeAt; i < slept.left.length; i++)
      after = Math.max(after, Math.abs(slept.left[i]!));
    expect(after).toBeGreaterThan(0.05);
  });

  it('stays awake while Freeze holds the burst', () => {
    const params = spectreParams(spec);
    const processor = loadSpectre(RATE, params);
    runSpectre(processor, burstThenSilence(6), params, (q) => {
      if (q === 20) setSpectre(params, { ...spec, freeze: true });
    });
    expect(processor.dsp.asleep).toBe(false);
  });
});
