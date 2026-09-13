/**
 * The User wave (#511): an operator whose single cycle is built from the
 * patch's `userPartials`. The worklet caches built tables across processors,
 * and the cache used to be keyed by `userKey` — '' in every patch — so two
 * different User waves shared whichever table was built first and a harmonic
 * edit went unheard. These render real output and read the harmonics back.
 * Split out of fmProcessor.test.ts for its length; the file name keeps the
 * `vitest run fmProcessor` filter.
 */
import { describe, expect, it } from 'vitest';

import { goertzel, loadProcessor, render } from './__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from './__fixtures__/workletHarness';
import { WAVE, makePatch } from './patch';
import type { Patch } from './patch';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK_FRAMES) + 1;

/** A3: low enough that the 2nd and 3rd harmonics sit far below Nyquist in every mip. */
const NOTE = 57;
const F0 = 440 * Math.pow(2, (NOTE - 69) / 12);
const SETTLE_S = 0.1;
const WINDOW_S = 0.2;
/** A harmonic the table carries beats one it lacks by at least this energy ratio. */
const PRESENT_OVER_ABSENT = 50;
const AUDIBLE_RMS = 0.01;

/** Odd harmonics only (square-ish) and even-led (2nd dominant): no shared overtone. */
const ODD = [1, 0, 0.5];
const EVEN = [1, 0.8, 0];

const userPatch = (partials: number[] | null): Patch =>
  makePatch({ ops: [{ wave: WAVE.USER, userPartials: partials, userKey: '' }] });

const on: ScheduledEvent = { type: 'noteOn', id: 1, note: NOTE, velocity: 0.9, frame: 0 };

interface Harmonics {
  second: number;
  third: number;
  rms: number;
  nonFinite: number;
}

const measure = (processor: ProcessorLike): Harmonics => {
  const after = render(loaded, processor, blocksFor(WINDOW_S));
  return {
    second: goertzel(after.samples, F0 * 2, SR),
    third: goertzel(after.samples, F0 * 3, SR),
    rms: after.rms,
    nonFinite: after.nonFinite,
  };
};

const held = (patch: Patch): Harmonics => {
  const processor = loaded.create(patch, 4);
  render(loaded, processor, blocksFor(SETTLE_S), [on]);
  return measure(processor);
};

describe('the User wave', () => {
  it('plays the partials it was given, audibly and finitely', () => {
    const odd = held(userPatch(ODD));
    expect(odd.nonFinite).toBe(0);
    expect(odd.rms).toBeGreaterThan(AUDIBLE_RMS);
    expect(odd.third).toBeGreaterThan(odd.second * PRESENT_OVER_ABSENT);
  });

  it('builds a separate table for different partials, even with the same userKey', () => {
    // Order matters: the odd table is cached first, which is what the
    // userKey-keyed cache then handed to the even patch as well.
    held(userPatch(ODD));
    const even = held(userPatch(EVEN));
    expect(even.nonFinite).toBe(0);
    expect(even.rms).toBeGreaterThan(AUDIBLE_RMS);
    expect(even.second).toBeGreaterThan(even.third * PRESENT_OVER_ABSENT);
  });

  it('hears a harmonic edit through a patch message', () => {
    const processor = loaded.create(userPatch(ODD), 4);
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    render(loaded, processor, blocksFor(SETTLE_S), [on]);
    const before = measure(processor);
    processor.inbox({ type: 'patch', patch: userPatch(EVEN) } as unknown as ScheduledEvent);
    render(loaded, processor, blocksFor(SETTLE_S));
    const after = measure(processor);
    expect(before.third).toBeGreaterThan(before.second * PRESENT_OVER_ABSENT);
    expect(after.second).toBeGreaterThan(after.third * PRESENT_OVER_ABSENT);
  });

  it('keeps an empty partial list (silence) apart from none (a sine)', () => {
    // Silence built first is the order that used to hand the sine patch the
    // silent table, when both keyed to ''.
    const silent = held(userPatch([]));
    const sine = held(userPatch(null));
    expect(silent.rms).toBe(0);
    expect(sine.rms).toBeGreaterThan(AUDIBLE_RMS);
  });

  it('plays a sine when no partials are set', () => {
    const sine = held(userPatch(null));
    expect(sine.rms).toBeGreaterThan(AUDIBLE_RMS);
    const fundamental = held(userPatch([1]));
    expect(sine.second).toBeCloseTo(fundamental.second, 6);
    expect(sine.third).toBeCloseTo(fundamental.third, 6);
  });
});
