/**
 * Echo as the first host (windsor#688, record `2026-10-11-wet-path-slot`),
 * through the insert chain that wraps it with its slot: an empty slot renders
 * what Echo rendered before it had one, a child sits on the loop's output
 * before Mix and the switch, Echo switched off is its input to the bit with a
 * child's tail ringing, and a child is tempo-fed and metered for exactly its
 * lifetime, across swaps.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { burst, reaches, rms, tones } from '../__fixtures__/audioAnalysis';
import { FakeContext, FakeWorkletNode, renderGraph } from '../__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from '../__fixtures__/fakeAudioNodes';
import { BLOCK } from '../__fixtures__/fakeAudioNodes';
import { graphParams, installParamWorklet } from '../__fixtures__/insertParamRig';
import { build, fieldValue, openSpec, otherValue } from '../__fixtures__/insertStageRig';
import { INSERT_AUTOMATION_FIELDS } from '../automation/automationInsertTables';
import { AudioLoadMeter } from '../cost/audioLoad';
import { createInsertChain } from '../mixer/insertChain';
import { PROCESSOR_NAME } from '../synth/workletMessages';
import { DEFAULT_CHORUS } from './chorusInsert';
import { DEFAULT_DELAY } from './delaySpec';
import { DEFAULT_ECHO } from './echoInsert';
import type { EchoSpec } from './echoInsert';
import { DEFAULT_FILTER } from './filterSpec';
import { INSERT_FADE_SECONDS } from './insertConstants';
import type { InsertRegistry, InsertSpec, InsertStage } from './insertRegistry';
import { INSERT_KINDS } from './insertRegistry';
import { meteredInsertRegistry } from './meteredInsertRegistry';
import { DEFAULT_PHASER } from './phaserSpec';
import { tempoInsertRegistry } from './tempoInsertRegistry';

const restore = installParamWorklet(new Set([PROCESSOR_NAME]));
afterAll(() => restore());

const SECONDS = 1;
const BURST_SECONDS = 0.05;
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const targets = (node: AudioNode): FakeNode[] => fake(node).outbound.map((c) => c.to);
const echo = (slot: InsertSpec | null, more: Partial<EchoSpec> = {}): InsertSpec =>
  ({ ...DEFAULT_ECHO, ...more, slot }) as InsertSpec;

/** An Echo chain on a fake context fed a two-tone burst, and its deferred disposals. */
async function rig(spec: InsertSpec, registry: InsertRegistry = INSERT_KINDS) {
  const context = new FakeContext();
  await context.audioWorklet.addModule('fm-processor.js');
  const source = new FakeWorkletNode(context, PROCESSOR_NAME, { numberOfInputs: 0 });
  source.feed = burst(tones(440, 660), BURST_SECONDS);
  const waiting: (() => void)[] = [];
  const chain = createInsertChain(
    context.asAudioContext(),
    source as unknown as AudioNode,
    [spec],
    {
      registry,
      owner: 'lead',
      later: (run) => void waiting.push(run),
    },
  );
  fake(chain.tail).connect(context.destination);
  const stage = (): InsertStage<InsertSpec> => chain.stages[0]!;
  const settle = (): void => waiting.splice(0).forEach((run) => run());
  return { context, source, chain, stage, settle };
}

describe('an empty slot', () => {
  it('renders Echo as it was before the slot, sample for sample, and builds nothing for it', async () => {
    for (const more of [{}, { mix: 1, feedback: 0.9, delayTime: 0.13 }]) {
      const now = await rig(echo(null, more));
      const nodes = now.context.nodes.length;
      const [today] = renderGraph(now.context, SECONDS, [fake(now.chain.tail)]);

      // Before windsor#688 the loop fed `wet` itself: the same graph with `direct` cut out.
      const was = await rig(echo(null, more));
      const { send, ret } = was.stage().wetPath!;
      const direct = targets(send.node).find((n) => n.outbound.some((c) => c.to === fake(ret)))!;
      fake(send.node).disconnect(direct);
      direct.disconnect();
      send.node.connect(ret);
      const [before] = renderGraph(was.context, SECONDS, [fake(was.chain.tail)]);

      expect(rms(today!.left)).toBeGreaterThan(0);
      expect(today!.left).toEqual(before!.left);
      expect(today!.right).toEqual(before!.right);
      // The destination, the source and Echo's own graph: the slot built nothing.
      const own = new FakeContext();
      INSERT_KINDS.echo.create(own.asAudioContext(), echo(null, more));
      expect(nodes).toBe(own.nodes.length + 1);
    }
  });
});

describe('a child on Echo', () => {
  it('takes the loop’s output beside the direct edge, which crosses out, and returns into wet', async () => {
    const empty = await rig(echo(null));
    const { stage, context } = await rig(echo(DEFAULT_CHORUS as InsertSpec));
    const { send, ret } = stage().wetPath!;
    // Into wet: the direct edge, made with Echo, and the child's fade.
    const [direct, fade] = fake(ret).inbound.map((c) => c.from) as [FakeGain, FakeGain];
    // From the loop's output: what an empty slot has, and the child's input, wired last.
    const was = targets(empty.stage().wetPath!.send.node).length;
    expect(targets(send.node)).toHaveLength(was + 1);
    expect(targets(send.node)).toContain(direct);
    const input = targets(send.node).at(-1)!;
    expect(reaches(input, fade)).toBe(true);
    // Outside the feedback: nothing the child plays reaches Echo's delay line.
    expect(reaches(input, context.delays[0]!)).toBe(false);
    expect(direct.gain.automation.at(-1)).toEqual({
      call: 'linearRampToValueAtTime',
      value: 0,
      time: INSERT_FADE_SECONDS,
    });
    expect(fade.gain.automation.at(-1)).toMatchObject({ value: 1, time: INSERT_FADE_SECONDS });
  });

  it('is its input to the bit with Echo off or at Mix 0, and off cuts the child’s ringing tail', async () => {
    for (const more of [{ enabled: false }, { mix: 0 }]) {
      const { context, source, chain } = await rig(echo(DEFAULT_CHORUS as InsertSpec, more));
      const [input, output] = renderGraph(context, SECONDS, [source, fake(chain.tail)]);
      expect(output!.left).toEqual(input!.left);
      expect(output!.right).toEqual(input!.right);
    }
    const { context, source, chain, stage } = await rig(
      echo(DEFAULT_CHORUS as InsertSpec, { feedback: 0.9 }),
    );
    // Switched off at block 150 (0.4 s), with the repeats and the chorus ringing.
    const OFF_BLOCK = 150;
    const off = echo(DEFAULT_CHORUS as InsertSpec, { feedback: 0.9, enabled: false });
    const [input, output] = renderGraph(context, SECONDS, [source, fake(chain.tail)], (block) => {
      if (block === OFF_BLOCK) stage().set(off);
    });
    const from = OFF_BLOCK * BLOCK;
    expect(rms(output!.left, Math.round(BURST_SECONDS * context.sampleRate), from)).toBeGreaterThan(
      0,
    );
    expect(output!.left.subarray(from)).toEqual(input!.left.subarray(from));
    expect(output!.right.subarray(from)).toEqual(input!.right.subarray(from));
  });
});

/** Every automation call a param of `context` logged, in build order, skipping the silent ones. */
const logged = (context: FakeContext) =>
  graphParams(context)
    .map(({ param }) => param.automation)
    .filter((calls) => calls.length > 0);

/** Echo's slot rows: every other kind's rows, its switch included, under `slot.`. */
const slotCases = INSERT_AUTOMATION_FIELDS.echo
  .filter((row) => row.childKind)
  .map((row) => ({ kind: row.childKind!, field: row.target.slice('slot.'.length), row }));

describe('a lane on a slot field', () => {
  it.each(slotCases)('slot.$field on a $kind child is that child’s own lane', async (c) => {
    const childSpec = openSpec(c.kind);
    const value = c.row.scale === 'switch' ? 0 : otherValue(c.row, fieldValue(childSpec, c.field));
    const how = c.row.scale === 'switch' ? 'set' : 'ramp';
    const { context, stage } = await rig(echo(childSpec));
    for (const { param } of graphParams(context)) param.automation.length = 0;
    stage().param!(`slot.${c.field}`)!.schedule(value, 1, how);
    const own = build(childSpec);
    own.stage.param!(c.field)!.schedule(value, 1, how);
    expect(logged(context).length).toBeGreaterThan(0);
    expect(logged(context)).toEqual(logged(own.context));
  });
});

describe('a child’s tempo', () => {
  it('reaches a Delay child at its build, after a swap and on every change, until its disposal', async () => {
    const heard: number[][] = [];
    const spied = {
      ...INSERT_KINDS.delay,
      create(context: BaseAudioContext, spec: InsertSpec) {
        const stage = INSERT_KINDS.delay.create(context, spec);
        const bpms: number[] = [];
        heard.push(bpms);
        return { ...stage, setTempo: (bpm: number) => void bpms.push(bpm) };
      },
    };
    const tempo = tempoInsertRegistry(120, { ...INSERT_KINDS, delay: spied } as InsertRegistry);
    const { stage, settle } = await rig(echo(DEFAULT_DELAY as InsertSpec), tempo.registry);
    tempo.setTempo(90);
    expect(heard).toEqual([[120, 90]]);

    stage().set(echo(DEFAULT_CHORUS as InsertSpec));
    settle();
    tempo.setTempo(100);
    stage().set(echo(DEFAULT_DELAY as InsertSpec));
    tempo.setTempo(140);
    expect(heard).toEqual([
      [120, 90],
      [100, 140],
    ]);
  });
});

describe('a child’s load meter', () => {
  it('attaches a worklet child for exactly its lifetime, across swaps', async () => {
    const meter = new AudioLoadMeter();
    const { stage, settle, chain } = await rig(
      echo(DEFAULT_PHASER as InsertSpec),
      meteredInsertRegistry(meter),
    );
    expect(meter.processorCount).toBe(1);
    stage().set(echo(DEFAULT_FILTER as InsertSpec));
    // Both while they cross, then the filter alone.
    expect(meter.processorCount).toBe(2);
    settle();
    expect(meter.processorCount).toBe(1);
    stage().set(echo(null));
    settle();
    expect(meter.processorCount).toBe(0);
    stage().set(echo(DEFAULT_PHASER as InsertSpec));
    expect(meter.processorCount).toBe(1);
    chain.dispose();
    expect(meter.processorCount).toBe(0);
  });
});
