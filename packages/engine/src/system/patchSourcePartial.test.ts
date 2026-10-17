/**
 * A part's library links, `patchSource` (windsor#669) and `rackSource`
 * (windsor#862), play nothing: a live partial setting or clearing either is
 * applied without being reported as an unknown field, and the rest of the
 * partial still lands.
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

describe.each(['patchSource', 'rackSource'] as const)("a part's %s on the live system", (key) => {
  it('is neither refused nor reported, set or cleared', async () => {
    const sys = await system();
    const { hat } = FULL_SLOT;
    expect(sys.apply({ parts: { [hat]: { [key]: 'bell' } } })).toEqual({
      ok: true,
      ignored: [],
    });
    // The app clears the link with an explicit `undefined` (its `partChange` is untyped).
    const cleared = { parts: { [hat]: { [key]: undefined } } } as unknown as DocumentPartial;
    expect(sys.apply(cleared)).toEqual({
      ok: true,
      ignored: [],
    });
  });

  it('leaves the rest of the partial to land', async () => {
    const sys = await system();
    const result = sys.apply({
      transport: { bpm: 90 },
      parts: { [FULL_SLOT.hat]: { [key]: 'bell', velocity: 0.5 } },
    });
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(sys.readout().bpm).toBe(90);
  });
});
