/**
 * `AudioSystem` and the engine's output stage (windsor#93): a song's
 * `master.output` lands on the stage at `initMusic`, and a live partial
 * changes it in place, with no graph rebuilt; the aux path goes through it
 * as the music does.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function system(document: ArrangementDocument) {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const sys = new AudioSystem(engine, { defer: (run) => run() });
  await sys.init();
  sys.initMusic(document);
  const stage = engine.outputStage!;
  const node = stage.node as unknown as FakeWorkletNode;
  const param = (name: string): number => node.parameters.get(name)!.value;
  return { context, sys, stage, node, param };
}

describe('the output stage under a song', () => {
  it('plays a song with no master.output on the limiter at −1 dBFS, lookahead off', async () => {
    const { stage, param } = await system(FULL_DOCUMENT);
    expect(stage.settings).toEqual({ mode: 'limiter', ceilingDb: -1, lookahead: false });
    expect([param('mode'), param('ceilingDb'), param('lookahead')]).toEqual([0, -1, 0]);
    expect(stage.latencyFrames).toBe(0);
  });

  it("plays on the song's own settings", async () => {
    const { stage, param } = await system({
      ...FULL_DOCUMENT,
      master: { level: 1, inserts: [], output: { mode: 'soft', ceilingDb: -3, lookahead: false } },
    });
    expect(stage.settings).toEqual({ mode: 'soft', ceilingDb: -3, lookahead: false });
    expect([param('mode'), param('ceilingDb')]).toEqual([1, -3]);
  });

  it('changes mode, ceiling and lookahead live, on the same node, merging a partial', async () => {
    const { sys, stage, node, param } = await system(FULL_DOCUMENT);
    const edges = (node as unknown as FakeNode).inbound.length;
    expect(sys.apply({ master: { output: { ceilingDb: -4, lookahead: true } } })).toEqual({
      ok: true,
      ignored: [],
    });
    expect(stage.settings).toEqual({ mode: 'limiter', ceilingDb: -4, lookahead: true });
    expect(stage.latencyFrames).toBe(72);
    expect(sys.apply({ master: { output: { mode: 'hard' } } }).ok).toBe(true);
    expect(stage.settings).toEqual({ mode: 'hard', ceilingDb: -4, lookahead: true });
    expect([param('mode'), param('ceilingDb'), param('lookahead')]).toEqual([2, -4, 1]);
    expect(sys.masterStrip?.spec.output).toEqual(stage.settings);
    // A level edit leaves the stage as it is.
    sys.apply({ master: { level: 0.5 } });
    expect(stage.settings.mode).toBe('hard');
    expect(sys.engine.outputStage).toBe(stage);
    expect((node as unknown as FakeNode).inbound).toHaveLength(edges);
  });

  it('clamps an out-of-range ceiling and reports the correction', async () => {
    const { sys, stage } = await system(FULL_DOCUMENT);
    const result = sys.apply({ master: { output: { ceilingDb: -30 } } });
    expect(result.ok).toBe(true);
    expect(result.ignored).toEqual(['master.output.ceilingDb: clamped -30 to -12']);
    expect(stage.settings.ceilingDb).toBe(-12);
  });

  it('takes the aux path through the stage too', async () => {
    const { sys, node } = await system(FULL_DOCUMENT);
    const sources = (n: FakeNode): FakeNode[] => n.inbound.map((c) => c.from);
    expect(sources(node as unknown as FakeNode)).toEqual([sys.engine.master]);
    const master = sys.engine.master as unknown as FakeNode;
    expect(sources(master).length).toBeGreaterThanOrEqual(2);
  });
});
