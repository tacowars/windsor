/**
 * `GroupBuses` on its own, over a built `StandingGraph` on the headless
 * graph stand-in (windsor#285): the document's groups built into the music
 * bus, and a live partial's three steps — `begin` builds, unlists and edits;
 * `release` sends a part on a group that has gone to Master; `finish` fades
 * each removed group shut and disposes it once the fade has landed.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { fake, sources, targets } from '../__fixtures__/stripRig';
import type { PartStrip } from '../mixer/channelStrip';
import type { ChannelStrip, GroupSpec } from '../mixer/mix';
import { RETURNS } from '../mixer/mix';
import { FmEngine } from '../synth/fmEngine';
import { GroupBuses } from './groupBuses';
import { StandingGraph } from './standingGraph';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

const group = (id: number): GroupSpec => ({
  id,
  name: `Group ${id}`,
  level: 1,
  pan: 0,
  inserts: [],
});

async function rig() {
  const engine = new FmEngine(new FakeContext().asAudioContext());
  await engine.init();
  const queue: (() => void)[] = [];
  const routeOptions = { defer: (run: () => void) => queue.push(run) };
  const graph = new StandingGraph(engine, RETURNS, routeOptions);
  graph.build();
  const groups = new GroupBuses({ context: engine.context, graph, routeOptions });
  const flush = (): void => {
    for (const run of queue.splice(0)) run();
  };
  return { graph, groups, flush, queue };
}

/** A strip that only records its Output. */
function stubStrip(output: ChannelStrip['output']): PartStrip {
  const stub = {
    output,
    setOutput(next: ChannelStrip['output']): boolean {
      stub.output = next;
      return true;
    },
  };
  return stub as unknown as PartStrip;
}

describe('GroupBuses', () => {
  it('builds the document groups into the music bus, by id', async () => {
    const { graph, groups } = await rig();
    groups.build([group(2), group(5)]);
    expect(groups.all().map((g) => g.id)).toEqual([2, 5]);
    expect(targets(groups.get(5)!.output)).toEqual([fake(graph.standing().musicBus.input)]);
    expect(groups.get(3)).toBeUndefined();
  });

  it('lands a partial in order: build and edit, release the strips, then retire', async () => {
    const { groups, flush, queue } = await rig();
    groups.build([group(1), group(2)]);
    const leaving = groups.get(1)!;
    const plan = groups.plan({ 1: null, 2: { level: 0.5 }, 3: group(3) });
    expect(groups.all().map((g) => g.id)).toEqual([1, 2]);
    expect(groups.begin(plan)).toEqual([]);
    // Unlisted at once, so nothing can be routed onto it; still standing.
    expect(groups.get(1)).toBeUndefined();
    expect(groups.all().map((g) => g.id)).toEqual([2, 3]);
    expect(groups.get(2)!.spec.level).toBe(0.5);
    const tracks = new Map([
      [0, stubStrip({ group: 1 })],
      [1, stubStrip({ group: 2 })],
      [2, stubStrip('sidechain')],
    ]);
    expect(groups.release(tracks)).toEqual(['parts.0.strip.output']);
    expect(tracks.get(0)!.output).toBe('master');
    expect(tracks.get(1)!.output).toEqual({ group: 2 });
    groups.finish();
    expect(leaving.open).toBe(false);
    expect(targets(leaving.output)).toHaveLength(1);
    expect(queue).toHaveLength(1);
    flush();
    expect(targets(leaving.output)).toEqual([]);
    expect(targets(leaving.input)).toEqual([]);
  });

  it('refuses a ninth group in the plan, before anything is built', async () => {
    const { groups } = await rig();
    groups.build(Array.from({ length: 8 }, (_, i) => group(i)));
    const plan = groups.plan({ 9: group(9) });
    expect(plan.error).toMatch(/at most 8 groups/);
    expect(groups.all()).toHaveLength(8);
  });

  it('disposes every group, a fading one included, and only once', async () => {
    const { graph, groups, flush } = await rig();
    groups.build([group(1), group(2)]);
    const all = groups.all();
    groups.begin(groups.plan({ 1: null }));
    groups.finish();
    groups.dispose();
    flush();
    for (const bus of all) {
      expect(targets(bus.output)).toEqual([]);
      expect(targets(bus.input)).toEqual([]);
    }
    expect(sources(graph.standing().musicBus.input)).toEqual([]);
    expect(groups.all()).toEqual([]);
  });
});
