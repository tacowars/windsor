/**
 * The part meter bank's main-thread side (windsor#540) on the fake graph:
 * lazy, a silent tap on one node, slot `k` on input `k` through every
 * attach, detach and reattach, stale reports ignored per slot, and nothing
 * left connected after `setActive(false)` or `dispose()`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { MUSIC_PARTS_MAX } from '../audioConstants';
import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import type { FakeGain } from '../__fixtures__/fakeAudioNodes';
import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import type { PartMeterBank } from './partMeterBank';
import { createPartMeterBank } from './partMeterBank';
import {
  PART_METER_BANK_NAME,
  PART_METER_FIELDS,
  partMeterAckIndex,
} from './partMeterBankConstants';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function rig(): Promise<{
  context: FakeContext;
  bank: PartMeterBank;
  part: () => FakeGain;
  nodes: () => FakeWorkletNode[];
}> {
  const context = new FakeContext();
  await context.audioWorklet.addModule('peak-meter-processor.js');
  const bank = createPartMeterBank(context.asAudioContext());
  return {
    context,
    bank,
    part: () => context.createGain(),
    nodes: () => context.workletNodes.filter((node) => node.name === PART_METER_BANK_NAME),
  };
}

const node = (gain: FakeGain): AudioNode => gain as unknown as AudioNode;

/** Which part feeds each input, by slot. */
const wiring = (bank: FakeWorkletNode): Map<number, unknown> =>
  new Map(bank.inbound.map((edge) => [edge.input, edge.from]));

/** A report from the processor: slot k's fields all `k + 1` hundredths, overload on odd slots. */
function report(ack: number): Float32Array {
  const data = new Float32Array(partMeterAckIndex(MUSIC_PARTS_MAX) + 1);
  for (let k = 0; k < MUSIC_PARTS_MAX; k++) {
    data.fill((k + 1) / 100, k * PART_METER_FIELDS, (k + 1) * PART_METER_FIELDS - 1);
    data[(k + 1) * PART_METER_FIELDS - 1] = k % 2;
  }
  data[partMeterAckIndex(MUSIC_PARTS_MAX)] = ack;
  return data;
}

const receive = (bank: FakeWorkletNode, data: Float32Array): void => bank.port.onmessage!({ data });

describe('the part meter bank', () => {
  it('builds and posts nothing until made active, then taps every attached part on its slot', async () => {
    const { bank, part, nodes, context } = await rig();
    const [a, b] = [part(), part()];
    bank.attach(0, node(a));
    bank.attach(MUSIC_PARTS_MAX - 1, node(b));
    bank.setActive(false);
    expect(nodes()).toEqual([]);
    expect(a.outbound).toEqual([]);
    bank.setActive(true);
    bank.setActive(true);
    expect(nodes()).toHaveLength(1);
    const [meter] = nodes();
    expect(meter!.numberOfInputs).toBe(MUSIC_PARTS_MAX);
    expect(wiring(meter!)).toEqual(
      new Map([
        [0, a],
        [MUSIC_PARTS_MAX - 1, b],
      ]),
    );
    const sink = meter!.outbound[0]!.to as FakeGain;
    expect(sink.gain.value).toBe(0);
    expect(sink.outbound[0]!.to).toBe(context.destination);
    expect(meter!.posted).toEqual([]);
  });

  it('keeps each slot on its own part through add, remove and reorder', async () => {
    const { bank, part, nodes } = await rig();
    const parts = Array.from({ length: 4 }, part);
    // The song's list in one order, then attached again in another: slots, not places.
    for (const slot of [0, 1, 2, 3]) bank.attach(slot, node(parts[slot]!));
    bank.setActive(true);
    const [meter] = nodes();
    for (const slot of [3, 1, 0, 2]) bank.attach(slot, node(parts[slot]!));
    expect(wiring(meter!)).toEqual(new Map(parts.map((p, slot) => [slot, p])));
    // Removed: the edge goes and the processor clears the slot.
    bank.detach(1);
    expect(parts[1]!.outbound).toEqual([]);
    expect(meter!.posted).toEqual([{ type: 'clear', slot: 1, seq: 1 }]);
    // Added on the freed slot, and a part moved onto a slot another held.
    const [added, moved] = [part(), part()];
    bank.attach(1, node(added));
    bank.attach(2, node(moved));
    expect(parts[2]!.outbound).toEqual([]);
    expect(meter!.posted.at(-1)).toEqual({ type: 'clear', slot: 2, seq: 2 });
    expect(wiring(meter!)).toEqual(
      new Map([
        [0, parts[0]],
        [1, added],
        [2, moved],
        [3, parts[3]],
      ]),
    );
  });

  it('reads each slot from its stretch of the report, ignoring a slot’s reports from before its clear', async () => {
    const { bank, part, nodes } = await rig();
    for (const slot of [0, 1, 2]) bank.attach(slot, node(part()));
    bank.setActive(true);
    const [meter] = nodes();
    receive(meter!, report(0));
    expect(bank.read(1)).toEqual({
      type: 'peaks',
      left: Math.fround(0.02),
      right: Math.fround(0.02),
      holdLeft: Math.fround(0.02),
      holdRight: Math.fround(0.02),
      overload: true,
    });
    const revision = bank.revision;
    bank.detach(1);
    bank.attach(1, node(part()));
    expect(bank.read(1)).toMatchObject({ left: 0, holdLeft: 0, overload: false });
    // Posted before the processor handled the clear: stale for slot 1 alone.
    receive(meter!, report(0));
    expect(bank.read(1)).toMatchObject({ left: 0, overload: false });
    expect(bank.read(2).left).toBe(Math.fround(0.03));
    receive(meter!, report(1));
    expect(bank.read(1).left).toBe(Math.fround(0.02));
    expect(bank.revision).toBeGreaterThan(revision);
  });

  it('resets one slot’s latch and holds at once, and on the processor', async () => {
    const { bank, part, nodes } = await rig();
    bank.attach(3, node(part()));
    bank.reset(3);
    bank.setActive(true);
    const [meter] = nodes();
    receive(meter!, report(0));
    bank.reset(3);
    expect(meter!.posted).toEqual([{ type: 'reset', slot: 3, seq: 1 }]);
    expect(bank.read(3)).toMatchObject({
      left: Math.fround(0.04),
      holdLeft: 0,
      holdRight: 0,
      overload: false,
    });
    expect(() => bank.reset(MUSIC_PARTS_MAX)).toThrow(RangeError);
    expect(() => bank.read(-1)).toThrow(RangeError);
  });

  it('tears everything down when made inactive, ignores late reports and starts again', async () => {
    const { bank, part, nodes } = await rig();
    const a = part();
    bank.attach(5, node(a));
    bank.setActive(true);
    const [first] = nodes();
    const sink = first!.outbound[0]!.to as FakeGain;
    receive(first!, report(0));
    bank.setActive(false);
    expect(first!.posted).toEqual([{ type: 'stop' }]);
    expect(first!.inbound).toEqual([]);
    expect(first!.outbound).toEqual([]);
    expect(sink.outbound).toEqual([]);
    expect(first!.port.onmessage).toBeNull();
    expect(bank.read(5).left).toBe(0);
    bank.setActive(true);
    const [, second] = nodes();
    expect(wiring(second!)).toEqual(new Map([[5, a]]));
  });

  it('disconnects everything on dispose and cannot start again', async () => {
    const { bank, part, nodes } = await rig();
    const a = part();
    bank.attach(0, node(a));
    bank.setActive(true);
    const [meter] = nodes();
    bank.dispose();
    bank.dispose();
    expect(a.outbound).toEqual([]);
    expect(meter!.inbound).toEqual([]);
    expect(meter!.outbound).toEqual([]);
    bank.attach(1, node(part()));
    bank.setActive(true);
    expect(nodes()).toHaveLength(1);
  });
});
