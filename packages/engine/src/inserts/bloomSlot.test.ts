/**
 * bloom as a host (windsor#713, records `2026-10-11-bloom-insert` E2 and
 * `2026-10-11-wet-path-slot`), through the insert chain that wraps it with its
 * slot, as `echoSlot.test.ts` does for Echo.
 *
 * The fake context can't run bloom's worklet in a graph or a param's ramp, so
 * the stage is built on it (its wiring and every schedule it writes) and the
 * audio is the shipped processor rendered beside it, fed the stage's own
 * `split` schedule sample by sample, with the host's sum modelled as the stage
 * wires it: output 0 plus each child's fade × the child(output 1) × output 2
 * (`__fixtures__/bloomSlotHarness.ts`). The children here are identity kinds
 * (`fakeSlotHost.ts`), so `child(output 1)` is output 1 itself.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { mixed, noise, tone } from '../__fixtures__/bloomHarness';
import {
  hostSum,
  renderPlain,
  renderSlot,
  sumError,
  type SlotRender,
} from '../__fixtures__/bloomSlotHarness';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from '../__fixtures__/fakeAudioNodes';
import { reaches } from '../__fixtures__/audioAnalysis';
import { SLOT_KINDS } from '../__fixtures__/fakeSlotHost';
import { graphParams, installParamWorklet } from '../__fixtures__/insertParamRig';
import type { ParamWorkletNode } from '../__fixtures__/insertParamRig';
import { build, fieldValue, openSpec, otherValue } from '../__fixtures__/insertStageRig';
import { INSERT_AUTOMATION_FIELDS } from '../automation/automationInsertTables';
import { AudioLoadMeter } from '../cost/audioLoad';
import { createInsertChain } from '../mixer/insertChain';
import { BLOOM_SLOT } from './bloomConstants';
import { DEFAULT_BLOOM } from './bloomSpec';
import type { BloomSpec } from './bloomSpec';
import { DEFAULT_CHORUS } from './chorusInsert';
import { DEFAULT_FILTER } from './filterSpec';
import { INSERT_FADE_SECONDS } from './insertConstants';
import type { InsertRegistry, InsertSpec, InsertStage } from './insertRegistry';
import { INSERT_KINDS } from './insertRegistry';
import { meteredInsertRegistry } from './meteredInsertRegistry';
import { DEFAULT_PHASER } from './phaserSpec';

const restore = installParamWorklet();
afterAll(() => restore());

const RATE = 48000;
const FRAMES = Math.round(1.2 * RATE);
const FADE_FRAMES = Math.round(INSERT_FADE_SECONDS * RATE);
const SOURCE = mixed(tone(220, 0.2, RATE), tone(330, 0.1, RATE), noise(0.02));
const SPEC: Partial<BloomSpec> = { mix: 0.75, amount: 0.8, spread: 0.6 };
/** An identity child's sum against the output without one: float32 rounding of each node. */
const SUM_TOLERANCE = 1e-5;
/** The arrival and the departure, off block boundaries as the main thread's clock is. */
const ON = Math.round(0.4 * RATE) + 37;
const OFF = Math.round(0.8 * RATE) + 91;

/** bloom and the fake identity kinds, `tint` and `tone`. */
const REGISTRY = {
  ...INSERT_KINDS,
  tint: SLOT_KINDS.tint,
  tone: SLOT_KINDS.tone,
} as InsertRegistry;
const TINT = { kind: 'tint', id: 'c1' } as unknown as InsertSpec;
const TONE = { kind: 'tone', id: 'c1' } as unknown as InsertSpec;

const bloom = (slot: InsertSpec | null, more: Partial<BloomSpec> = SPEC): InsertSpec =>
  ({ ...DEFAULT_BLOOM, ...more, slot }) as InsertSpec;
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const targets = (node: AudioNode): FakeNode[] => fake(node).outbound.map((c) => c.to);

/** A bloom chain on a fake context, its deferred disposals, and its schedules read by frame. */
function rig(spec: InsertSpec, registry: InsertRegistry = REGISTRY) {
  const context = new FakeContext();
  const head = context.createGain();
  const waiting: (() => void)[] = [];
  const chain = createInsertChain(context.asAudioContext(), head as unknown as AudioNode, [spec], {
    registry,
    owner: 'lead',
    later: (run) => void waiting.push(run),
  });
  const stage = (): InsertStage<InsertSpec> => chain.stages[0]!;
  const node = stage().processor as unknown as ParamWorkletNode;
  const split = node.parameters.get(BLOOM_SLOT.splitParam);
  const ret = stage().wetPath!.ret as unknown as FakeGain;
  /** Every child fade into the return, live and leaving, summed at `frame`. */
  const liveFades = (frame: number): number =>
    ret.inbound.reduce((sum, c) => sum + (c.from as FakeGain).gain.valueAt(frame / RATE), 0);
  const liveSplit = (frame: number): number => split.valueAt(frame / RATE);
  // What the schedules held before each change, kept: a later schedule never moves the past, but
  // the fake's replay drops a ramp a cancel-and-hold cuts short (`paramTimeline.ts`).
  const past = { split: new Float64Array(FRAMES), fades: new Float64Array(FRAMES), until: 0 };
  /** At `frame`, `spec` lands on the stage, as the main thread would at that time. */
  const at = (frame: number, next: InsertSpec): void => {
    for (let f = past.until; f < frame; f++) {
      past.split[f] = liveSplit(f);
      past.fades[f] = liveFades(f);
    }
    past.until = Math.max(past.until, frame);
    context.currentTime = frame / RATE;
    stage().set(next);
  };
  const fades = (frame: number): number =>
    frame < past.until ? past.fades[frame]! : liveFades(frame);
  const splitAt = (frame: number): number =>
    frame < past.until ? past.split[frame]! : liveSplit(frame);
  const settle = (): void => waiting.splice(0).forEach((run) => run());
  return { context, chain, stage, node, split, ret, at, fades, splitAt, settle };
}

type Rig = ReturnType<typeof rig>;

/** The processor rendered on `r`'s own `split` schedule. */
const renderOn = (r: Rig, more: Partial<BloomSpec> = SPEC): SlotRender =>
  renderSlot(more, { rate: RATE, frames: FRAMES, source: SOURCE, split: r.splitAt });

const none = renderSlot(SPEC, { rate: RATE, frames: FRAMES, source: SOURCE, split: () => 0 });

describe('an empty slot', () => {
  it('renders bloom as it was before the slot, bit for bit, and builds nothing for it', () => {
    for (const more of [SPEC, {}, { mix: 1, freeze: true, spread: 0 }]) {
      const r = rig(bloom(null, more));
      expect(r.split.automation).toEqual([]);
      expect(r.ret.inbound).toEqual([]);
      const now = renderOn(r, more);
      const before = renderPlain(more, { rate: RATE, frames: FRAMES, source: SOURCE });
      expect(now.left).toEqual(before.left);
      expect(now.right).toEqual(before.right);
      // The head and bloom's own graph: the slot built nothing.
      const own = new FakeContext();
      INSERT_KINDS.bloom.create(own.asAudioContext(), bloom(null, more));
      expect(r.context.nodes.length).toBe(own.nodes.length + 1);
    }
  });
});

describe('a child on bloom', () => {
  it('takes output 1, returns through its fade into the return, and split crosses on the fade’s ramp', () => {
    const r = rig(bloom(null));
    r.at(ON, bloom(TINT));
    const [fade] = r.ret.inbound.map((c) => c.from) as [FakeGain];
    const toChild = r.node.outbound.filter((c) => c.output === BLOOM_SLOT.wetOutput);
    expect(toChild).toHaveLength(1);
    expect(reaches(toChild[0]!.to, fade)).toBe(true);
    expect(targets(fade as unknown as AudioNode)).toEqual([r.ret]);
    const start = ON / RATE,
      end = start + INSERT_FADE_SECONDS;
    expect(r.split.automation.at(-1)).toEqual({
      call: 'linearRampToValueAtTime',
      value: 1,
      time: end,
    });
    expect(fade.gain.automation.at(-1)).toEqual({
      call: 'linearRampToValueAtTime',
      value: 1,
      time: end,
    });
    for (const frame of [ON - 1, ON, ON + 100, ON + FADE_FRAMES / 2, ON + FADE_FRAMES + 1])
      expect(r.splitAt(frame)).toBe(fade.gain.valueAt(frame / RATE));
  });

  it.each([{ mix: 0 }, { enabled: false }])(
    'at %o is its input to the bit, whatever the child plays',
    (corner) => {
      const spec = { ...SPEC, ...corner };
      const r = rig(bloom(DEFAULT_CHORUS as InsertSpec, spec));
      const out = renderOn(r, spec);
      expect(out.left).toEqual(out.input);
      for (const child of [1, 3])
        for (let i = 0; i < FRAMES; i += 5)
          expect(hostSum(out, i, r.fades(i), child)[0]).toBe(out.input[i]);
    },
  );
});

describe('an identity child', () => {
  /** The host's sum on `r`'s schedules against bloom without a child. */
  const error = (r: Rig, range?: readonly [number, number]): number => {
    const out = renderOn(r);
    return sumError(out, none, r.fades, range);
  };

  it('sums to bloom without a child through an arrival and a departure', () => {
    const r = rig(bloom(null));
    r.at(ON, bloom(TINT));
    r.at(OFF, bloom(null));
    expect(r.splitAt(ON + FADE_FRAMES / 2)).toBeCloseTo(0.5, 6);
    expect(error(r)).toBeLessThan(SUM_TOLERANCE);
    // Before the arrival and once the departure has landed, output 0 is bloom without the slot.
    const out = renderOn(r);
    const landed = OFF + FADE_FRAMES + 1;
    expect(out.left.subarray(0, ON)).toEqual(none.left.subarray(0, ON));
    expect(out.left.subarray(landed)).toEqual(none.left.subarray(landed));
    expect(out.right.subarray(landed)).toEqual(none.right.subarray(landed));
  });

  it('sums to it when built with the child, and through a kind change, where split stays put', () => {
    const r = rig(bloom(TINT));
    const calls = r.split.automation.length;
    r.at(ON, bloom(TONE));
    expect(r.split.automation).toHaveLength(calls);
    expect(r.ret.inbound).toHaveLength(2);
    expect(error(r, [FADE_FRAMES + 1, FRAMES])).toBeLessThan(SUM_TOLERANCE);
  });

  it('sums to it when a departure reverses an arrival mid-window', () => {
    const r = rig(bloom(null));
    r.at(ON, bloom(TINT));
    r.at(ON + FADE_FRAMES / 2, bloom(null));
    expect(error(r)).toBeLessThan(SUM_TOLERANCE);
  });

  it('turns round with no step when an arrival reverses a departure mid-window', () => {
    const r = rig(bloom(TINT));
    r.at(ON, bloom(null));
    r.at(ON + FADE_FRAMES / 2, bloom(TONE));
    // The layer's share: what output 0 keeps, plus what the children bring back.
    const share = (i: number): number => 1 - r.splitAt(i) + r.fades(i);
    let step = 0,
      low = 1;
    for (let i = ON - 1; i < ON + 2 * FADE_FRAMES; i++) {
      step = Math.max(step, Math.abs(share(i + 1) - share(i)));
      low = Math.min(low, share(i));
    }
    expect(step).toBeLessThan(1 / FADE_FRAMES);
    // The leaving child is gone half a window before split is back at 1: a dip to 3/4 of the
    // layer, continuous, from the slot module's crossing (Echo's direct edge does the same).
    expect(low).toBeGreaterThan(0.75 - 1e-9);
    // And the audio is exactly that share of the layer over the dry share: no step of its own.
    const out = renderOn(r);
    const dry = renderSlot(SPEC, { rate: RATE, frames: FRAMES, source: SOURCE, split: () => 1 });
    let worst = 0;
    for (let i = 0; i < FRAMES; i++) {
      const [l] = hostSum(out, i, r.fades(i));
      const expected = dry.left[i]! + share(i) * (none.left[i]! - dry.left[i]!);
      worst = Math.max(worst, Math.abs(l - expected));
    }
    expect(worst).toBeLessThan(SUM_TOLERANCE);
  });
});

/** Every automation call a param of `context` logged, in build order, skipping the silent ones. */
const logged = (context: FakeContext) =>
  graphParams(context)
    .map(({ param }) => param.automation)
    .filter((calls) => calls.length > 0);

/** bloom's slot rows: every other kind's rows, its switch included, under `slot.`. */
const slotCases = INSERT_AUTOMATION_FIELDS.bloom
  .filter((row) => row.childKind)
  .map((row) => ({ kind: row.childKind!, field: row.target.slice('slot.'.length), row }));

describe('the slot rows', () => {
  it('are bloom’s own rows, then every other kind’s under slot.', () => {
    const rows = INSERT_AUTOMATION_FIELDS.bloom;
    const own = rows.filter((row) => !row.childKind);
    expect(own.length).toBeGreaterThan(0);
    expect(rows.slice(0, own.length)).toEqual(own);
    expect(own.every((row) => !row.target.startsWith('slot.'))).toBe(true);
    const kinds = new Set(slotCases.map((c) => c.kind));
    expect(kinds.has('bloom')).toBe(false);
    expect(kinds.has('echo')).toBe(true);
  });

  it.each(slotCases)('slot.$field on a $kind child is that child’s own lane', (c) => {
    const childSpec = openSpec(c.kind);
    const value = c.row.scale === 'switch' ? 0 : otherValue(c.row, fieldValue(childSpec, c.field));
    const how = c.row.scale === 'switch' ? 'set' : 'ramp';
    const { context, stage } = rig(bloom(childSpec), INSERT_KINDS);
    for (const { param } of graphParams(context)) param.automation.length = 0;
    stage().param!(`slot.${c.field}`)!.schedule(value, 1, how);
    const own = build(childSpec);
    own.stage.param!(c.field)!.schedule(value, 1, how);
    expect(logged(context).length).toBeGreaterThan(0);
    expect(logged(context)).toEqual(logged(own.context));
  });
});

describe('a child’s load meter', () => {
  it('attaches a worklet child beside bloom’s own processor for exactly its lifetime, across swaps', () => {
    const meter = new AudioLoadMeter();
    const { stage, settle, chain } = rig(
      bloom(DEFAULT_PHASER as InsertSpec),
      meteredInsertRegistry(meter),
    );
    // bloom's processor and the phaser's.
    expect(meter.processorCount).toBe(2);
    stage().set(bloom(DEFAULT_FILTER as InsertSpec));
    expect(meter.processorCount).toBe(3);
    settle();
    expect(meter.processorCount).toBe(2);
    stage().set(bloom(null));
    settle();
    expect(meter.processorCount).toBe(1);
    stage().set(bloom(DEFAULT_PHASER as InsertSpec));
    expect(meter.processorCount).toBe(2);
    chain.dispose();
    expect(meter.processorCount).toBe(0);
  });
});
