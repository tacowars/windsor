/**
 * A group bus on its own (windsor#285 decision 1): input, the chain, the
 * fade, the pan, the level and the gate, into its destination, with a lazy
 * meter after the gate. With no inserts, unity level and centre pan it
 * passes its input through untouched; a settings-only chain edit is param
 * writes and any other list re-wires inside the fade with the level
 * untouched; the gate ramps only on a change; dispose leaves no edge. Its
 * level and pan have lane handles a knob never fights, and a re-wire tells
 * its hook (windsor#614).
 */
import { afterAll, describe, expect, it } from 'vitest';

import { tones } from '../__fixtures__/audioAnalysis';
import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import { renderGraph } from '../__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from '../__fixtures__/fakeAudioNodes';
import type { built } from '../__fixtures__/stripRig';
import {
  NOW,
  TEST_KINDS,
  boost,
  fake,
  installWorklet,
  rig,
  scale,
  sources,
  targets,
} from '../__fixtures__/stripRig';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { InsertSpec } from '../inserts/insertRegistry';
import type { GroupBus, GroupBusOptions } from './groupBus';
import { createGroupBus } from './groupBus';
import type { GroupSpec } from './mix';
import { PEAK_METER_NAME } from './peakMeterConstants';

const undo = installWorklet();
afterAll(undo);

const HZ = 440;
const AMPLITUDE = 0.4;
const SECONDS = 0.05;
/** The strip tests' tolerance: equal to six decimal places. */
const CLOSE = 1e-6;

const DRUMS: GroupSpec = { id: 3, name: 'Drums', level: 1, pan: 0, inserts: [] };

async function build(spec: Partial<GroupSpec> = {}, options: GroupBusOptions = {}) {
  const { context, part, dry } = await rig();
  await context.audioWorklet.addModule('peak-meter-processor.js');
  (part.node as unknown as { feed: unknown }).feed = tones(HZ, HZ * 1.5, AMPLITUDE);
  const bus = createGroupBus(context.asAudioContext(), { ...DRUMS, ...spec }, dry, {
    registry: TEST_KINDS,
    defer: NOW,
    ...options,
  });
  part.output.connect(bus.input);
  return { context, part, dry, bus };
}

/** The nodes a fake node feeds, and the nodes feeding it. */
const outOf = (node: FakeNode): FakeNode[] => node.outbound.map((c) => c.to);
const into = (node: FakeNode): FakeNode[] => node.inbound.map((c) => c.from);

/** The bus's nodes after the chain, in order: fade, the rotation's in and out, level, gate. */
function after(bus: GroupBus, tail: AudioNode): FakeNode[] {
  const fade = targets(tail)[0]!;
  const rotationIn = outOf(fade)[0]!;
  const level = sources(bus.output)[0]!;
  const rotationOut = into(level)[0]!;
  return [fade, rotationIn, rotationOut, level, fake(bus.output)];
}

const gain = (node: FakeNode): FakeGain['gain'] => (node as FakeGain).gain;

describe('a group bus', () => {
  it('runs input, inserts, fade, pan, level and gate into the destination', async () => {
    const { bus, dry } = await build({ inserts: [scale(0.5)] });
    const [stage] = bus.inserts as unknown as (typeof built)[number][];
    expect(targets(bus.input)).toEqual([fake(stage!.input)]);
    const [fade, rotationIn, rotationOut, level, gate] = after(bus, stage!.output);
    expect(fade!.kind).toBe('gain');
    expect(rotationIn!.kind).toBe('splitter');
    expect(rotationOut!.kind).toBe('merger');
    expect(outOf(level!)).toEqual([gate]);
    expect(outOf(gate!)).toEqual([fake(dry)]);
    expect(bus.spec).toEqual({ ...DRUMS, inserts: [scale(0.5)] });
  });

  it('passes its input through untouched with no inserts, unity level and centre pan', async () => {
    const { bus, context, part } = await build();
    const [input, output] = renderGraph(context, SECONDS, [fake(part.output), fake(bus.output)]);
    for (let i = 0; i < input!.left.length; i++) {
      expect(Math.abs(output!.left[i]! - input!.left[i]!)).toBeLessThan(CLOSE);
      expect(Math.abs(output!.right[i]! - input!.right[i]!)).toBeLessThan(CLOSE);
    }
  });

  it('sets its level, pan, name and switches, and reports them in its spec', async () => {
    const { bus } = await build();
    bus.setLevel(0.5);
    bus.setPan(-0.25);
    bus.setName('Kit');
    bus.setMute(true);
    bus.setSolo(false);
    expect(bus.spec).toEqual({
      ...DRUMS,
      name: 'Kit',
      level: 0.5,
      pan: -0.25,
      mute: true,
      solo: false,
    });
    const level = sources(bus.output)[0]!;
    expect(gain(level).value).toBe(0.5);
    // The switches are flags: the roster resolves the gate.
    expect(bus.open).toBe(true);
  });

  it('lands a settings-only chain as param writes, and re-wires any other inside the fade', async () => {
    const { bus, context } = await build({ inserts: [scale(1), boost(1)] });
    const before = context.nodes.map((n) => [...n.outbound]);
    bus.setInserts([scale(0.5), boost(2)]);
    expect(context.nodes.map((n) => [...n.outbound])).toEqual(before);
    const level = sources(bus.output)[0]!;
    bus.setLevel(0.7);
    bus.setInserts([boost(2)]);
    const [stage] = bus.inserts as unknown as (typeof built)[number][];
    expect(bus.inserts.map((s) => s.kind)).toEqual(['boost']);
    expect(targets(bus.input)).toEqual([fake(stage!.input)]);
    const fade = targets(stage!.output)[0]!;
    expect(gain(fade).automation.map((a) => [a.call, a.value])).toEqual([
      ['cancelScheduledValues', 1],
      ['setValueAtTime', 1],
      ['linearRampToValueAtTime', 0],
      ['cancelScheduledValues', 0],
      ['setValueAtTime', 0],
      ['linearRampToValueAtTime', 1],
    ]);
    expect(gain(level).value).toBe(0.7);
    expect(gain(level).automation).toEqual([]);
  });

  it('refuses a kind the registry lacks before touching anything', async () => {
    const { bus, context } = await build();
    const before = context.nodes.map((n) => [...n.outbound]);
    expect(() => bus.setInserts([{ kind: 'fuzz' } as unknown as InsertSpec])).toThrow(/fuzz/);
    expect(context.nodes.map((n) => [...n.outbound])).toEqual(before);
  });

  it('ramps its gate only on a change, and sets it at once when asked for no ramp', async () => {
    const { bus, context } = await build();
    (context as FakeContext).currentTime = 1;
    const gate = gain(fake(bus.output));
    bus.setOpen(true);
    expect(gate.automation).toEqual([]);
    bus.setOpen(false);
    expect(gate.automation.at(-1)).toEqual({
      call: 'linearRampToValueAtTime',
      value: 0,
      time: 1 + INSERT_FADE_SECONDS,
    });
    expect(bus.open).toBe(false);
    bus.setOpen(true, 0);
    expect(gate.automation.slice(-2)).toEqual([
      { call: 'cancelScheduledValues', value: 0, time: 1 },
      { call: 'setValueAtTime', value: 1, time: 1 },
    ]);
  });

  it('meters after the gate, and builds the meter only once it is made active', async () => {
    const { bus, context } = await build();
    const meters = () => context.workletNodes.filter((n) => n.name === PEAK_METER_NAME);
    expect(meters()).toEqual([]);
    bus.meter.setActive(true);
    expect(into(meters()[0]!)).toEqual([fake(bus.output)]);
    renderGraph(context, SECONDS);
    expect(bus.meter.read().holdLeft).toBeGreaterThan(AMPLITUDE / 2);
    const shut = await build();
    shut.bus.meter.setActive(true);
    shut.bus.setOpen(false, 0);
    renderGraph(shut.context, SECONDS);
    expect([shut.bus.meter.read().holdLeft, shut.bus.meter.read().holdRight]).toEqual([0, 0]);
  });

  it('removes every edge it made on dispose, and disposes each insert once', async () => {
    const { bus, part, dry, context } = await build({ inserts: [scale(1), boost(1)] });
    bus.meter.setActive(true);
    const stages = bus.inserts as unknown as (typeof built)[number][];
    part.output.disconnect(bus.input);
    bus.dispose();
    expect(stages.map((s) => s.disposed)).toEqual([1, 1]);
    expect(sources(dry)).toEqual([]);
    expect(targets(bus.input)).toEqual([]);
    expect(targets(bus.output)).toEqual([]);
    const meter = context.workletNodes.find((n) => n.name === PEAK_METER_NAME)!;
    expect(into(meter)).toEqual([]);
  });
});

describe("a group bus's lane handles (windsor#614)", () => {
  it('holds its level from a lane, records a knob turn meanwhile, and gives the knob back on release', async () => {
    const { bus } = await build({ level: 0.8 });
    const level = gain(sources(bus.output)[0]!);
    const handle = bus.automation('level')!;
    handle.hold(0.3, 1);
    expect(level.automation.slice(-1)).toEqual([{ call: 'setValueAtTime', value: 0.3, time: 1 }]);
    bus.setLevel(0.5);
    expect(level.value).not.toBe(0.5);
    expect(bus.spec.level).toBe(0.5);
    handle.release(2);
    expect(handle.engaged).toBe(false);
    expect(level.automation.slice(-1)).toEqual([{ call: 'setValueAtTime', value: 0.5, time: 2 }]);
    bus.setLevel(0.6);
    expect(level.value).toBe(0.6);
  });

  it("drives its pan through the rotation's own handle, so a pan knob waits too", async () => {
    const { bus } = await build();
    const rotationIn = outOf(targets(bus.input)[0]!)[0]!;
    const gains = outOf(rotationIn).map((node) => gain(node));
    expect(gains).toHaveLength(4);
    const handle = bus.automation('pan')!;
    handle.hold(1, 1);
    expect(gains.map((g) => g.automation.at(-1)?.time)).toEqual([1, 1, 1, 1]);
    const held = gains.map((g) => g.value);
    bus.setPan(-1);
    expect(gains.map((g) => g.value)).toEqual(held);
    expect(bus.spec.pan).toBe(-1);
    handle.release(2);
    expect(gains.map((g) => g.value)).not.toEqual(held);
  });

  it('has no handle on a field a group lacks', async () => {
    const { bus } = await build();
    for (const field of ['send.a', 'lowCut', 'mute']) expect(bus.automation(field)).toBeUndefined();
  });

  it('reports its specs, the list waiting out a fade, and tells its hook once the re-wire lands', async () => {
    const waiting: (() => void)[] = [];
    const rebuilt: GroupBus[] = [];
    const { bus } = await build(
      { inserts: [scale(1)] },
      { defer: (run) => waiting.push(run), insertsRebuilt: (b) => rebuilt.push(b) },
    );
    bus.setInserts([scale(0.5)]);
    expect(bus.insertSpecs).toEqual([scale(0.5)]);
    expect(rebuilt).toEqual([]);
    bus.setInserts([boost(2), scale(0.5)]);
    expect(bus.insertSpecs).toEqual([scale(0.5)]);
    expect(bus.nextInsertSpecs).toEqual([boost(2), scale(0.5)]);
    for (const run of waiting.splice(0)) run();
    expect(bus.insertSpecs).toEqual([boost(2), scale(0.5)]);
    expect(bus.inserts.map((stage) => stage.kind)).toEqual(['boost', 'scale']);
    expect(rebuilt).toEqual([bus]);
  });
});
