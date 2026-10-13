/**
 * A part's `ccMappings` (windsor#782) are the console's setup and play
 * nothing by themselves: a live partial setting or clearing them is applied
 * without being reported as an unknown field, and the rest of it lands.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { FULL_DOCUMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import type { DocumentPartial } from '../song/arrangementDocument';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

const MAPPING = {
  source: { device: null, channel: 1, cc: 74 },
  target: 'voice.filter.cutoff',
  min: 2000,
  max: 6000,
  inverted: false,
};

/** A partial carrying `ccMappings` on the hat, beside `rest`, whatever the document type names. */
const withMappings = (ccMappings: unknown, rest: object = {}): DocumentPartial =>
  ({ parts: { [FULL_SLOT.hat]: { ccMappings, ...rest } } }) as unknown as DocumentPartial;

describe("a part's ccMappings on the live system (windsor#782)", () => {
  it('are neither refused nor reported, set or cleared, and the rest lands', async () => {
    const engine = new FmEngine(new FakeContext().asAudioContext());
    const sys = new AudioSystem(engine, { defer: (run) => run() });
    await sys.init();
    sys.initMusic(FULL_DOCUMENT);
    expect(sys.apply(withMappings([MAPPING]))).toEqual({ ok: true, ignored: [] });
    expect(sys.apply(withMappings(undefined))).toEqual({ ok: true, ignored: [] });
    const result = sys.apply({ transport: { bpm: 90 }, ...withMappings([], { velocity: 0.5 }) });
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(sys.readout().bpm).toBe(90);
  });
});
