/**
 * A partial touching only the song's name and tags (windsor#440) changes no
 * audio: `apply` builds no node, keeps every strip and stage, and reports
 * nothing; alongside other fields, `meta` is not reported as unknown.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { FULL_DOCUMENT, FULL_SLOT } from '../__fixtures__/fullArrangement';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function system(): Promise<{ sys: AudioSystem; context: FakeContext }> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const sys = new AudioSystem(engine, { defer: (run) => run() });
  await sys.init();
  sys.initMusic(FULL_DOCUMENT);
  return { sys, context };
}

describe('a meta partial (windsor#440)', () => {
  it('changes no node and rebuilds nothing', async () => {
    const { sys, context } = await system();
    const slots = Object.values(FULL_SLOT);
    const strips = slots.map((slot) => sys.strip(musicPartName(slot)));
    const stages = strips.map((strip) => strip?.stages);
    const nodes = context.nodes.length;
    expect(sys.apply({ meta: { name: 'x', tags: [] } })).toEqual({ ok: true, ignored: [] });
    expect(context.nodes.length).toBe(nodes);
    expect(slots.map((slot) => sys.strip(musicPartName(slot)))).toEqual(strips);
    slots.forEach((slot, i) => {
      expect(sys.strip(musicPartName(slot))).toBe(strips[i]);
      expect(sys.strip(musicPartName(slot))?.stages).toEqual(stages[i]);
    });
  });

  it('applies the other fields of a partial and does not report meta', async () => {
    const { sys } = await system();
    const result = sys.apply({ meta: { name: 'x', tags: ['acid'] }, transport: { bpm: 90 } });
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(sys.readout().bpm).toBe(90);
  });
});
