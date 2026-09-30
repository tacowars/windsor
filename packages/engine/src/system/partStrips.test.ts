/**
 * `PartStrips` on its own, over a built `StandingGraph` on the headless graph
 * stand-in: a music part lands dry on the music bus and an aux part on the aux
 * fader, each on its strip and on the load meter; `remove` takes one part down
 * and nothing else; `dispose` takes the strips down, each strip's peak meter
 * with it (windsor#155).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

import { reaches } from '../__fixtures__/audioAnalysis';
import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeContext, installFakeAudioWorklet, sourceOf } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { LOW_CUT_MIN_HZ } from '../audioConstants';
import type { ChannelStrip } from '../mixer/mix';
import { PEAK_METER_NAME } from '../mixer/peakMeterConstants';
import { RETURNS } from '../mixer/mix';
import { PRESETS } from '../patch/presets';
import { FmEngine } from '../synth/fmEngine';
import type { PartStripsOptions } from './partStrips';
import { PartStrips } from './partStrips';
import { StandingGraph } from './standingGraph';
import { SystemLoadMeter } from './systemLoadMeter';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const PATCH = PRESETS['pad-drift']!;

/** The meter nodes built on the engine's context so far. */
const meterNodes = (engine: FmEngine): FakeWorkletNode[] =>
  (engine.context as unknown as FakeContext).workletNodes.filter((n) => n.name === PEAK_METER_NAME);

const desk = (level: number): ChannelStrip => ({
  level,
  pan: 0,
  lowCut: LOW_CUT_MIN_HZ,
  inserts: [],
  sends: { a: 0.2 },
});

async function rig(extra: Partial<PartStripsOptions> = {}, build = true) {
  const engine = new FmEngine(new FakeContext().asAudioContext());
  await engine.init();
  const routeOptions = { defer: (run: () => void) => run() };
  const graph = new StandingGraph(engine, RETURNS, routeOptions);
  if (build) graph.build();
  const meter = new SystemLoadMeter(engine.context, true);
  const parts = new PartStrips({
    engine,
    graph,
    meter,
    mix: { lead: desk(0.4) },
    routeOptions,
    ...extra,
  });
  return { engine, graph, meter, parts };
}

describe('PartStrips.createMusic', () => {
  it('builds the part on its strip, dry into the music bus, and meters it', async () => {
    const { engine, graph, meter, parts } = await rig();
    const part = parts.createMusic('drone', PATCH, 4);
    const strip = parts.get('drone');
    expect(strip?.part).toBe(part);
    expect(engine.getPart('drone')).toBe(part);
    expect(reaches(fake(part.output), fake(graph.standing().musicBus.input))).toBe(true);
    expect(reaches(fake(part.output), fake(graph.auxNode()))).toBe(false);
    expect(meter.processorCount).toBe(1);
  });

  it('takes the strip it is handed, or else the desk’s strip for that name', async () => {
    const { parts } = await rig();
    expect(parts.createMusic('lead', PATCH, 4).gain.value).toBe(0.4);
    expect(parts.createMusic('pad', PATCH, 4, desk(0.7)).gain.value).toBe(0.7);
  });

  it('builds the processor with the seed and the opening notes for its name', async () => {
    const events = [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }] as never;
    const partSeed = vi.fn((name: string) => name.length);
    const partEvents = vi.fn(() => events);
    const { engine, parts } = await rig({ partSeed, partEvents });
    const create = vi.spyOn(engine, 'createPart');
    const part = parts.createMusic('drone', PATCH, 4);
    expect(partSeed).toHaveBeenCalledWith('drone');
    expect(create.mock.calls[0]?.[1]).toMatchObject({ seed: 5, events, maxVoices: 4 });
    expect(sourceOf(part).events).toEqual(events);
  });

  it('refuses a part before the graph is built', async () => {
    const { parts } = await rig({}, false);
    expect(() => parts.createMusic('drone', PATCH, 4)).toThrow(/init\(\)/);
    expect(() => parts.createAux('ui', PATCH, 4)).toThrow(/init\(\)/);
  });
});

describe('PartStrips.createAux', () => {
  it('builds the part dry into the aux fader, past the music bus', async () => {
    const { graph, parts } = await rig();
    const part = parts.createAux('ui', PATCH, 2);
    expect(reaches(fake(part.output), fake(graph.auxNode()))).toBe(true);
    expect(reaches(fake(part.output), fake(graph.standing().musicBus.input))).toBe(false);
    expect(parts.get('ui')?.part).toBe(part);
  });
});

describe('PartStrips.remove and dispose', () => {
  it('removes one part: its strip, its meter entry and its processor, and nothing else', async () => {
    const { engine, meter, parts } = await rig();
    const drone = parts.createMusic('drone', PATCH, 4);
    parts.createMusic('lead', PATCH, 4);
    parts.remove('drone');
    expect(parts.get('drone')).toBeUndefined();
    expect(engine.getPart('drone')).toBeUndefined();
    expect(fake(drone.output).outbound).toEqual([]);
    expect(meter.processorCount).toBe(1);
    expect(parts.get('lead')).toBeDefined();
    expect(engine.getPart('lead')).toBeDefined();
  });

  it('disposes every strip, leaving the processors to the engine', async () => {
    const { engine, parts } = await rig();
    const drone = parts.createMusic('drone', PATCH, 4);
    parts.createAux('ui', PATCH, 2);
    parts.dispose();
    expect(parts.get('drone')).toBeUndefined();
    expect(parts.get('ui')).toBeUndefined();
    expect(fake(drone.output).outbound).toEqual([]);
    expect(engine.getPart('drone')).toBe(drone);
  });

  it('disposes a removed part’s meter, and every meter on dispose, for music and aux alike', async () => {
    const { engine, parts } = await rig();
    parts.createMusic('drone', PATCH, 4);
    parts.createMusic('lead', PATCH, 4);
    parts.createAux('ui', PATCH, 2);
    const strips = ['drone', 'lead', 'ui'].map((name) => parts.get(name)!);
    expect(meterNodes(engine)).toEqual([]);
    for (const strip of strips) strip.meter.setActive(true);
    const [drone, lead, ui] = meterNodes(engine);
    expect(meterNodes(engine)).toHaveLength(3);

    parts.remove('drone');
    expect(drone!.inbound).toEqual([]);
    expect(drone!.posted).toContainEqual({ type: 'stop' });
    expect(lead!.inbound).toHaveLength(1);

    parts.dispose();
    expect(lead!.inbound).toEqual([]);
    expect(ui!.inbound).toEqual([]);
    for (const strip of strips) strip.meter.setActive(true);
    expect(meterNodes(engine)).toHaveLength(3);
  });
});
