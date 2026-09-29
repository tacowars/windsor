/**
 * `StandingGraph` on its own, over the headless graph stand-in: what exists
 * before `build()`, the wiring it builds (the music bus through the song
 * master, the returns into the master's input, the aux fader straight to the
 * engine's master), the two faders held across a build, and the teardown.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { reaches } from '../__fixtures__/audioAnalysis';
import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from '../__fixtures__/fakeAudioNodes';
import { RETURNS } from '../mixer/mix';
import { FmEngine } from '../synth/fmEngine';
import { StandingGraph } from './standingGraph';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const gainOf = (node: AudioNode): number => (node as unknown as FakeGain).gain.value;

async function engineReady(): Promise<FmEngine> {
  const engine = new FmEngine(new FakeContext().asAudioContext());
  await engine.init();
  return engine;
}

async function built(): Promise<{ engine: FmEngine; graph: StandingGraph }> {
  const engine = await engineReady();
  const graph = new StandingGraph(engine, RETURNS, { defer: (run) => run() });
  graph.build();
  return { engine, graph };
}

describe('StandingGraph before build()', () => {
  it('has no nodes, and refuses the ones a part is routed onto', async () => {
    const graph = new StandingGraph(await engineReady(), RETURNS, {});
    expect(graph.masterStrip).toBeNull();
    expect(graph.returnBus('room')).toBeUndefined();
    expect(() => graph.standing()).toThrow(/init\(\)/);
    expect(() => graph.auxNode()).toThrow(/init\(\)/);
  });

  it('holds a fader value set early and lands it on the nodes it builds', async () => {
    const graph = new StandingGraph(await engineReady(), RETURNS, {});
    graph.setMusicGain(0.5);
    graph.setAuxGain(0.25);
    expect([graph.musicGain, graph.auxGain]).toEqual([0.5, 0.25]);
    graph.build();
    expect(gainOf(graph.standing().musicBus.output)).toBe(0.5);
    expect(gainOf(graph.auxNode())).toBe(0.25);
  });
});

describe('StandingGraph.build()', () => {
  it('runs the music bus through the song master to the engine master', async () => {
    const { engine, graph } = await built();
    const { musicBus } = graph.standing();
    const master = graph.masterStrip!;
    expect(reaches(fake(musicBus.input), fake(master.input))).toBe(true);
    expect(reaches(fake(master.output), fake(musicBus.output))).toBe(true);
    expect(reaches(fake(musicBus.output), fake(engine.master))).toBe(true);
    // The highpass no longer feeds the fader directly: the song master is between.
    const filterTargets = fake(musicBus.filter!).outbound.map((c) => c.to);
    expect(filterTargets).toEqual([fake(master.input)]);
  });

  it('builds one return per spec, summed into the song master', async () => {
    const { graph } = await built();
    const { returns } = graph.standing();
    expect(Object.keys(returns)).toEqual(Object.keys(RETURNS));
    for (const name of Object.keys(RETURNS)) {
      expect(graph.returnBus(name)).toBe(returns[name]);
      expect(reaches(fake(returns[name]!.output), fake(graph.masterStrip!.input))).toBe(true);
    }
  });

  it('wires the aux fader straight to the engine master, past the song master', async () => {
    const { engine, graph } = await built();
    const aux = fake(graph.auxNode());
    expect(aux.outbound.map((c) => c.to)).toEqual([fake(engine.master)]);
    expect(reaches(aux, fake(graph.masterStrip!.input))).toBe(false);
  });

  it('moves a fader on its node once built', async () => {
    const { graph } = await built();
    graph.setMusicGain(0.7);
    graph.setAuxGain(0.3);
    expect(gainOf(graph.standing().musicBus.output)).toBe(0.7);
    expect(gainOf(graph.auxNode())).toBe(0.3);
  });
});

describe('StandingGraph.dispose()', () => {
  it('disconnects everything, forgets the nodes and keeps the fader values', async () => {
    const { graph } = await built();
    graph.setMusicGain(0.6);
    const { musicBus } = graph.standing();
    const aux = fake(graph.auxNode());
    graph.dispose();
    expect(fake(musicBus.output).outbound).toEqual([]);
    expect(aux.outbound).toEqual([]);
    expect(graph.masterStrip).toBeNull();
    expect(graph.returnBus('room')).toBeUndefined();
    expect(() => graph.standing()).toThrow(/init\(\)/);
    expect(graph.musicGain).toBe(0.6);
  });
});
