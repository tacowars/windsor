/**
 * The `liveRetune` switch: whether a `patch` message reaches the voices that
 * are already sounding. Off, a ringing voice keeps its note-on patch (the
 * game's click-free preset swap); on, the arrangement console's knobs are
 * heard while they turn. Split out of fmProcessor.test.ts for its length; the
 * file name keeps the `vitest run fmProcessor` filter.
 */
import { describe, expect, it } from 'vitest';

import { goertzel, loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { makePatch } from '../patch/patch';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK_FRAMES) + 1;
const noteHz = (note: number): number => 440 * Math.pow(2, (note - 69) / 12);

const NOTE = 69;
const RATIO = 2;
/** Long enough for the note to reach sustain, and for the amp ramp after a swap to settle. */
const SETTLE_S = 0.1;
const WINDOW_S = 0.2;
/** The pitch that should be sounding carries this many times the energy of the other. */
const DOMINANCE = 10;

interface Swap {
  processor: ProcessorLike;
  /** Energy at the note-on pitch and at the doubled pitch, in the window after the swap. */
  original: number;
  doubled: number;
}

/** A lone sine held at A4; the patch swaps to ratio 2 mid-note. */
const afterSwap = (live: boolean): Swap => {
  const processor = loaded.create(makePatch(), 8);
  if (live) {
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
  }
  processor.inbox({ type: 'noteOn', id: 1, note: NOTE, velocity: 0.9, frame: 0 });
  render(loaded, processor, blocksFor(SETTLE_S));
  processor.inbox({
    type: 'patch',
    patch: makePatch({ ops: [{ ratio: RATIO }] }),
  } as unknown as ScheduledEvent);
  render(loaded, processor, blocksFor(SETTLE_S));
  const after = render(loaded, processor, blocksFor(WINDOW_S));
  const f = noteHz(NOTE);
  return {
    processor,
    original: goertzel(after.samples, f, SR),
    doubled: goertzel(after.samples, f * RATIO, SR),
  };
};

const sounding = (processor: ProcessorLike): number =>
  processor.voices.filter((v) => v.active && !v.fading).length;

describe('liveRetune', () => {
  it('keeps a ringing voice on its note-on patch by default', () => {
    const { original, doubled } = afterSwap(false);
    expect(original).toBeGreaterThan(doubled * DOMINANCE);
  });

  it('re-points ringing voices at the new patch once enabled', () => {
    const { processor, original, doubled } = afterSwap(true);
    expect(doubled).toBeGreaterThan(original * DOMINANCE);
    // The same voice carried on: still sounding, no second note-on.
    expect(sounding(processor)).toBe(1);
  });
});
