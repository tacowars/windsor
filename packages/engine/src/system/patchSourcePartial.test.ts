/**
 * A part's `patchSource` (windsor#669) is the app's library link and plays
 * nothing: a live partial setting or clearing it is applied without being
 * reported as an unknown field, and the rest of the partial still lands.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { FULL_DOCUMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import type { DocumentPartial } from '../song/arrangementDocument';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function system(): Promise<AudioSystem> {
  const engine = new FmEngine(new FakeContext().asAudioContext());
  const sys = new AudioSystem(engine, { defer: (run) => run() });
  await sys.init();
  sys.initMusic(FULL_DOCUMENT);
  return sys;
}

describe("a part's patchSource on the live system (windsor#669)", () => {
  it('is neither refused nor reported, set or cleared', async () => {
    const sys = await system();
    const { hat } = FULL_SLOT;
    expect(sys.apply({ parts: { [hat]: { patchSource: 'bell' } } })).toEqual({
      ok: true,
      ignored: [],
    });
    // The app clears the link with an explicit `undefined` (its `partChange` is untyped).
    const cleared = { parts: { [hat]: { patchSource: undefined } } } as unknown as DocumentPartial;
    expect(sys.apply(cleared)).toEqual({
      ok: true,
      ignored: [],
    });
  });

  it('leaves the rest of the partial to land', async () => {
    const sys = await system();
    const result = sys.apply({
      transport: { bpm: 90 },
      parts: { [FULL_SLOT.hat]: { patchSource: 'bell', velocity: 0.5 } },
    });
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(sys.readout().bpm).toBe(90);
  });
});
