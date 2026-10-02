/**
 * The voice lanes' handles on the main thread (windsor#346, record
 * `2026-10-01-song-automation-lanes` decisions 2, 10 and 16): a lane takes
 * one of its part's slots on its first hold, tells the processor which
 * target the slot moves, writes offsets from the patch's value (a log2
 * ratio for the cutoff, the LFO rates and, from a 1 ms floor, the decay
 * times: windsor#347, windsor#419), recomputes
 * them against an edited patch, and gives the slot back at its release. An
 * offline render builds each part with its slot map, so its lanes play from
 * the first sample. The worklet's side is `fmProcessorAutomation.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT, FULL_SLOT, withDocumentPart } from '../__fixtures__/fullArrangement';
import { installWorklet, rig } from '../__fixtures__/stripRig';
import type { AutomationHandle } from '../automation/automationHandles';
import { FM_LANES_MAX } from '../automation/automationTargetTables';
import { VOICE_TARGET_IDS, catalogRow } from '../automation/automationTargets';
import type { PartStrip } from '../mixer/channelStrip';
import { makeEnvelope, makePatch, type Patch } from '../patch/patch';
import { renderPass } from '../render/renderPass';
import { planFor } from '../render/renderSong';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { automationResolver } from '../system/automationResolver';
import type { AudioPart } from './audioPart';
import { FmEngine } from './fmEngine';
import { voiceAutomationHandle, voiceOffset } from './voiceAutomation';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installWorklet();
});
afterAll(() => restore());

const fake = (param: AudioParam): FakeParam => param as unknown as FakeParam;
const nodeOf = (part: AudioPart): FakeWorkletNode => part.node as unknown as FakeWorkletNode;
const stripOf = (part: AudioPart): PartStrip => ({ part }) as unknown as PartStrip;
const slotMap = (...paths: string[]): (string | null)[] =>
  Array.from({ length: FM_LANES_MAX }, (_, i) => paths[i] ?? null);
const lastPosted = (part: AudioPart): unknown => nodeOf(part).posted.at(-1);

function handleFor(part: AudioPart, path: string): AutomationHandle {
  const handle = voiceAutomationHandle(stripOf(part), { path }, catalogRow(`voice.${path}`)!);
  if (!handle) throw new Error(`no handle for ${path}`);
  return handle;
}

describe('a voice lane on its part (windsor#346)', () => {
  it('takes a slot at its first hold, tells the processor, and writes value − patch', async () => {
    const { part } = await rig();
    const level = part.patch.ops[1]!.level;
    const handle = handleFor(part, 'ops.1.level');
    expect(nodeOf(part).posted).toEqual([]);
    handle.hold(0.9, 0);
    handle.schedule(0.5, 1, 'ramp');
    handle.schedule(0.25, 2, 'set');
    expect(lastPosted(part)).toEqual({ type: 'voiceSlots', slots: slotMap('ops.1.level') });
    expect(fake(part.voiceSlotParams[0]!).automation).toEqual([
      { call: 'cancelScheduledValues', value: 0, time: 0 },
      { call: 'setValueAtTime', value: 0.9 - level, time: 0 },
      { call: 'linearRampToValueAtTime', value: 0.5 - level, time: 1 },
      { call: 'setValueAtTime', value: 0.25 - level, time: 2 },
    ]);
  });

  it('gives each target its own slot, and a target the slot it has', async () => {
    const { part } = await rig();
    handleFor(part, 'ops.1.level').hold(0.9, 0);
    handleFor(part, 'lfo.amount').hold(0.5, 0);
    handleFor(part, 'ops.1.level').hold(0.8, 1);
    expect(lastPosted(part)).toEqual({
      type: 'voiceSlots',
      slots: slotMap('ops.1.level', 'lfo.amount'),
    });
    expect(nodeOf(part).posted).toHaveLength(2);
    expect(part.voiceSlotOf('lfo.amount')).toBe(1);
  });

  it('sets its offset back to 0 at its release and frees the slot', async () => {
    const { part } = await rig();
    const handle = handleFor(part, 'ops.3.width');
    handle.hold(0.5, 0);
    handle.release(3);
    expect(fake(part.voiceSlotParams[0]!).automation.slice(-2)).toEqual([
      { call: 'cancelScheduledValues', value: 0.5 - part.patch.ops[3]!.width, time: 3 },
      { call: 'setValueAtTime', value: 0, time: 3 },
    ]);
    expect(lastPosted(part)).toEqual({ type: 'voiceSlots', slots: slotMap() });
    expect(part.voiceSlotOf('ops.3.width')).toBeUndefined();
  });

  it('writes the cutoff in octaves to a slot, as any ratio row (windsor#419)', async () => {
    const { part } = await rig();
    handleFor(part, 'filter.cutoff').hold(part.patch.filter.cutoff / 4, 0);
    expect(fake(part.voiceSlotParams[0]!).automation.at(-1)).toEqual({
      call: 'setValueAtTime',
      value: -2,
      time: 0,
    });
    expect(lastPosted(part)).toEqual({ type: 'voiceSlots', slots: slotMap('filter.cutoff') });
  });

  it("writes an LFO's rate as a log2 ratio of the patch's", async () => {
    const { part } = await rig();
    handleFor(part, 'lfo2.rate').hold(part.patch.lfo2.rate / 2, 0);
    expect(fake(part.voiceSlotParams[0]!).automation.at(-1)!.value).toBeCloseTo(-1, 12);
  });

  it('writes a decay time as a log2 ratio, and a decay curve as value − patch (windsor#347)', async () => {
    const { part } = await rig();
    const time = part.patch.ops[2]!.env.decayTime;
    handleFor(part, 'ops.2.env.decayTime').hold(time / 4, 0);
    handleFor(part, 'ops.2.env.decayCurve').hold(0.75, 0);
    expect(fake(part.voiceSlotParams[0]!).automation.at(-1)!.value).toBeCloseTo(-2, 12);
    expect(fake(part.voiceSlotParams[1]!).automation.at(-1)!.value).toBe(
      0.75 - part.patch.ops[2]!.env.decayCurve,
    );
  });

  it("takes a decay time's ratio from its 1 ms floor at either end, where its knob reads 0 (windsor#347)", () => {
    const path = 'filter.env.decayTime';
    const row = catalogRow(`voice.${path}`)!;
    expect([row.min, row.floor]).toEqual([0, 0.001]);
    const at = (decayTime: number): Patch =>
      makePatch({ filter: { env: makeEnvelope({ decayTime }) } });
    expect(voiceOffset(at(0), path, row, 0.5)).toBeCloseTo(Math.log2(500), 12);
    expect(voiceOffset(at(0.5), path, row, 0)).toBeCloseTo(-Math.log2(500), 12);
    expect(voiceOffset(at(0), path, row, 0)).toBe(0);
    expect(voiceOffset(at(0.0005), path, row, 0.001)).toBe(0);
  });

  it("takes an LFO rate's ratio from its 0.02 Hz floor over a patch rate of 0 (PR #421)", () => {
    for (const lfo of ['lfo', 'lfo2'] as const) {
      const path = `${lfo}.rate`;
      const row = catalogRow(`voice.${path}`)!;
      const still = makePatch({ [lfo]: { rate: 0 } });
      expect(voiceOffset(still, path, row, 4)).toBe(Math.log2(4 / 0.02));
      expect(voiceOffset(still, path, row, row.min)).toBe(0);
    }
  });

  it('recomputes the offset against an edited patch, so the lane value still wins', async () => {
    const { part } = await rig();
    const handle = handleFor(part, 'ops.0.feedback');
    handle.hold(0.5, 0);
    const edited = structuredClone(part.patch);
    edited.ops[0]!.feedback = -0.25;
    part.setPatch(edited);
    handle.hold(0.5, 1);
    expect(fake(part.voiceSlotParams[0]!).automation.at(-1)).toEqual({
      call: 'setValueAtTime',
      value: 0.75,
      time: 1,
    });
  });

  it('finds no slot past the eighth target and writes nothing', async () => {
    const { part } = await rig();
    const paths = ['ops.0.level', 'ops.1.level', 'ops.2.level', 'ops.3.level'];
    paths.push('ops.0.width', 'ops.1.width', 'ops.2.width', 'ops.3.width');
    for (const path of paths) handleFor(part, path).hold(0.5, 0);
    handleFor(part, 'lfo.amount').hold(0.5, 0);
    expect(part.voiceSlotOf('lfo.amount')).toBeUndefined();
    expect(lastPosted(part)).toEqual({ type: 'voiceSlots', slots: slotMap(...paths) });
  });

  it('hands out one handle per target, so a resync finds the one the player holds', async () => {
    const { part } = await rig();
    const resolve = automationResolver(() => stripOf(part));
    const first = resolve(0, 'voice.ops.1.width')!.handle;
    expect(resolve(0, 'voice.ops.1.width')!.handle).toBe(first);
    expect(resolve(0, 'voice.filter.cutoff')!.handle).toBe(
      resolve(0, 'voice.filter.cutoff')!.handle,
    );
    expect(resolve(0, 'voice.ops.2.width')!.handle).not.toBe(first);
    const { part: rebuilt } = await rig();
    expect(automationResolver(() => stripOf(rebuilt))(0, 'voice.ops.1.width')!.handle).not.toBe(
      first,
    );
  });

  it('has a handle for every voice row, the nine decay rows included (windsor#347)', async () => {
    const { part } = await rig();
    const resolve = automationResolver(() => stripOf(part));
    const resolved = VOICE_TARGET_IDS.filter((target) => resolve(0, target) !== undefined);
    expect(VOICE_TARGET_IDS.filter((target) => /\.decay(Time|Curve)$/.test(target))).toHaveLength(
      9,
    );
    expect(resolved).toEqual(VOICE_TARGET_IDS);
  });
});

describe('the slot map at construction (windsor#346)', () => {
  it('rides ahead of the held notes, and FmEngine builds a part with it', async () => {
    const { part } = await rig();
    handleFor(part, 'ops.0.width').hold(0.5, 0);
    part.holdNotes();
    part.noteOn(60, 1, 0);
    const held = part.takeHeldNotes();
    expect(held[0]).toEqual({ type: 'voiceSlots', slots: slotMap('ops.0.width') });
    expect(held.slice(1).map((m) => m.type)).toEqual(['noteOn']);

    const context = new FakeContext();
    const engine = new FmEngine(context.asAudioContext());
    await engine.init();
    const built = engine.createPart('built', { events: held, destination: null });
    expect(nodeOf(built).voiceSlots).toEqual(slotMap('ops.0.width'));
    expect(nodeOf(built).events).toEqual(held.slice(1));
    expect(built.voiceSlotOf('ops.0.width')).toBe(0);
  });

  it('builds an offline render with its voice lanes mapped and their opening offset held', async () => {
    const name = musicPartName(FULL_SLOT.hat);
    const document: ArrangementDocument = withDocumentPart(FULL_DOCUMENT, 'hat', {
      automation: [lane('voice.ops.0.level', [point(0, 0.25), point(96, 1)])],
    });
    const plan = planFor(document, { sampleRate: 8000, tailSeconds: 0 });
    let seen: { slots: unknown; opening: FakeParam['automation']; level: number } | undefined;
    await renderPass(
      document,
      { ...plan, endSeconds: Math.min(plan.endSeconds, 0.5) },
      { sampleRate: 8000, createContext: (init) => new FakeOfflineContext(init) },
      {
        channels: 2,
        attach: (system) => {
          const part = system.strip(name)!.part;
          const opening = fake(part.voiceSlotParams[0]!).automation.slice();
          seen = { slots: nodeOf(part).voiceSlots, opening, level: part.patch.ops[0]!.level };
          return () => {};
        },
      },
    );
    expect(seen!.slots).toEqual(slotMap('ops.0.level'));
    expect(seen!.opening.at(-1)).toEqual({
      call: 'setValueAtTime',
      value: 0.25 - seen!.level,
      time: 0,
    });
  });
});
