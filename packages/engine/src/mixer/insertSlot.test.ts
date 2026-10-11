/**
 * The slot module (windsor#688, record `2026-10-11-wet-path-slot`) on a fake
 * host: a child is wired `send → child → fade → ret`, crossfades on every
 * arrival, departure and kind change over one insert fade, takes a same-kind
 * or id-only change as its own `set`, is refused for a kind the registry
 * lacks, answers `slot.<f>`, moves with its host on a reorder, and goes with
 * it on a dispose, mid-fade included.
 */
import { describe, expect, it } from 'vitest';

import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeGain, FakeNode } from '../__fixtures__/fakeAudioNodes';
import type { FakeChild, FakeHandle, FakeSlotSpec } from '../__fixtures__/fakeSlotHost';
import { children, hosts, SLOT_KINDS, slotSpec } from '../__fixtures__/fakeSlotHost';
import { scale, TEST_KINDS } from '../__fixtures__/stripRig';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { InsertRegistry } from '../inserts/insertRegistry';
import { createInsertChain } from './insertChain';
import { slotChild } from './insertSlot';

const NOW = 1;
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const targets = (node: AudioNode): FakeNode[] => fake(node).outbound.map((c) => c.to);
const host = (slot?: FakeSlotSpec | null, id = 'h') =>
  slotSpec(slot === undefined ? { kind: 'host', id } : { kind: 'host', id, slot });

function rig(spec = host(), registry: InsertRegistry = SLOT_KINDS) {
  const context = new FakeContext();
  context.currentTime = NOW;
  const waiting: (() => void)[] = [];
  const head = context.createGain() as unknown as AudioNode;
  const chain = createInsertChain(context.asAudioContext(), head, [spec], {
    registry,
    owner: 'lead',
    later: (run) => void waiting.push(run),
  });
  return {
    context,
    chain,
    waiting,
    host: hosts.at(-1)!,
    stage: () => chain.stages.find((s) => s.kind === ('host' as string))!,
    settle: () => waiting.splice(0).forEach((run) => run()),
  };
}

/** The gain a child's output feeds: its fade. */
const fadeOf = (child: FakeChild): FakeGain => targets(child.output)[0] as unknown as FakeGain;
/** The children the host's send feeds now. */
const wired = (r: ReturnType<typeof rig>): FakeChild[] =>
  children.filter((c) => targets(r.host.send).includes(fake(c.input)));
const ramp = (from: number, to: number, at = NOW) => [
  { call: 'cancelScheduledValues', value: from, time: at },
  { call: 'setValueAtTime', value: from, time: at },
  { call: 'linearRampToValueAtTime', value: to, time: at + INSERT_FADE_SECONDS },
];
/** A change once every fade so far has run its course. */
const LATER = NOW + 1;
/** A change 6 ms into a 12 ms window: each fade is half way. */
const MID = NOW + INSERT_FADE_SECONDS / 2;
const clearFades = (...list: FakeChild[]) =>
  list.forEach((c) => (fadeOf(c).gain.automation.length = 0));

describe('an empty slot', () => {
  it('builds and routes nothing, with no slot or a null one', () => {
    for (const spec of [host(), host(null)]) {
      const before = children.length;
      const r = rig(spec);
      expect(children.length).toBe(before);
      expect(r.host.routes).toEqual([]);
      expect(targets(r.host.send)).toEqual([fake(r.host.direct)]);
      // The destination, the head and the host's five gains.
      expect(r.context.nodes).toHaveLength(7);
    }
  });
});

describe('the wiring', () => {
  it('wires send → child → fade → ret, the fade crossing in as route crosses the host’s edge', () => {
    const r = rig(host({ kind: 'tint' }));
    const tint = children.at(-1)!;
    expect(wired(r)).toEqual([tint]);
    expect(targets(tint.output)).toHaveLength(1);
    expect(targets(fadeOf(tint) as unknown as AudioNode)).toEqual([fake(r.host.ret)]);
    expect(fadeOf(tint).gain.automation).toEqual(ramp(0, 1));
    expect(r.host.routes).toEqual([true]);
  });
});

describe('a swap', () => {
  it('wires the new kind before set returns, crossfades over one window and disposes the old after', () => {
    const r = rig(host({ kind: 'tint' }));
    const tint = children.at(-1)!;
    clearFades(tint);
    r.context.currentTime = LATER;
    r.stage().set(host({ kind: 'tone' }));
    const tone = children.at(-1)!;
    expect(tone.kind).toBe('tone');
    expect((r.stage().param!('slot.rate') as FakeHandle).owner).toBe(tone);
    expect(wired(r)).toEqual([tint, tone]);
    expect(fadeOf(tint).gain.automation).toEqual(ramp(1, 0, LATER));
    expect(fadeOf(tone).gain.automation).toEqual(ramp(0, 1, LATER));
    expect(r.waiting).toHaveLength(1);
    expect(tint.disposed).toBe(0);

    const tintFade = fadeOf(tint);
    r.settle();
    expect(tint.disposed).toBe(1);
    expect(wired(r)).toEqual([tone]);
    expect(targets(tint.output)).toEqual([]);
    expect(tintFade.outbound).toEqual([]);
    expect(r.host.routes).toEqual([true]);
  });

  it('crosses one window with one route call into and out of empty', () => {
    const r = rig();
    r.stage().set(host({ kind: 'tint' }));
    const tint = children.at(-1)!;
    expect(r.host.routes).toEqual([true]);
    expect(fadeOf(tint).gain.automation).toEqual(ramp(0, 1));
    clearFades(tint);
    r.context.currentTime = LATER;
    r.stage().set(host(null));
    expect(r.host.routes).toEqual([true, false]);
    expect(fadeOf(tint).gain.automation).toEqual(ramp(1, 0, LATER));
    r.settle();
    expect(tint.disposed).toBe(1);
    expect(targets(r.host.send)).toEqual([fake(r.host.direct)]);
  });

  it('crossfades both of two changes inside one window, leaving one child wired', () => {
    const r = rig(host({ kind: 'tint' }));
    const first = children.at(-1)!;
    r.stage().set(host({ kind: 'tone' }));
    const second = children.at(-1)!;
    r.context.currentTime = MID;
    r.stage().set(host({ kind: 'tint' }));
    const third = children.at(-1)!;
    expect(third).not.toBe(first);
    // The second leaves from half way in, where its fade had reached.
    expect(fadeOf(second).gain.valueAt(MID)).toBeCloseTo(0.5, 9);
    expect(fadeOf(second).gain.automation.at(-1)).toEqual(ramp(0, 0, MID)[2]);
    expect(fadeOf(third).gain.automation).toEqual(ramp(0, 1, MID));
    expect(wired(r)).toEqual([first, second, third]);
    r.settle();
    expect([first.disposed, second.disposed, third.disposed]).toEqual([1, 1, 0]);
    expect(wired(r)).toEqual([third]);
    expect(r.host.routes).toEqual([true]);
  });

  it('ends child → none → child inside one window with one live child', () => {
    const r = rig(host({ kind: 'tint' }));
    const first = children.at(-1)!;
    r.stage().set(host(null));
    r.stage().set(host({ kind: 'tint' }));
    const second = children.at(-1)!;
    expect(second).not.toBe(first);
    expect(r.host.routes).toEqual([true, false, true]);
    r.settle();
    expect([first.disposed, second.disposed]).toEqual([1, 0]);
    expect(wired(r)).toEqual([second]);
    expect((r.stage().param!('slot.level') as FakeHandle).owner).toBe(second);
  });
});

/** Each fade's value at `time` as scheduled now, to compare with after a change there. */
const valuesAt = (gains: FakeGain[], time: number) => gains.map((g) => g.gain.valueAt(time));

describe('a change inside a window', () => {
  it('ramps a leaving child down from the value its fade has reached', () => {
    const r = rig();
    r.stage().set(host({ kind: 'tint' }));
    const fade = fadeOf(children.at(-1)!);
    r.context.currentTime = MID;
    r.stage().set(host(null));
    expect(fade.gain.automation.at(-2)!.value).toBeCloseTo(0.5, 9);
    expect(fade.gain.valueAt(MID + INSERT_FADE_SECONDS / 2)).toBeCloseTo(0.25, 9);
    expect(fade.gain.valueAt(MID + INSERT_FADE_SECONDS)).toBe(0);
  });

  it('turns every fade round with no step for child → none → child', () => {
    const r = rig(host({ kind: 'tint' }));
    const first = fadeOf(children.at(-1)!);
    const out = NOW + INSERT_FADE_SECONDS / 3;
    const back = NOW + (2 * INSERT_FADE_SECONDS) / 3;
    const heading = valuesAt([first], out);
    r.context.currentTime = out;
    r.stage().set(host(null));
    expect(valuesAt([first], out)).toEqual(heading);
    expect(heading[0]).toBeCloseTo(1 / 3, 9);
    const leaving = valuesAt([first], back);
    r.context.currentTime = back;
    r.stage().set(host({ kind: 'tint' }));
    const second = fadeOf(children.at(-1)!);
    expect(valuesAt([first, second], back)).toEqual([...leaving, 0]);
  });
});

describe('the same kind', () => {
  it('is the child’s own set, for new settings or an id-only change, with no re-wire and no fade', () => {
    const r = rig(host({ kind: 'tint', id: 'a' }));
    const tint = children.at(-1)!;
    clearFades(tint);
    const [built, nodes, sets] = [children.length, r.context.nodes.length, r.host.hostSets];
    r.stage().set(host({ kind: 'tint', id: 'b' }));
    r.stage().set(host({ kind: 'tint', id: 'b', level: 0.5 }));
    expect(tint.sets).toEqual([
      { kind: 'tint', id: 'b' },
      { kind: 'tint', id: 'b', level: 0.5 },
    ]);
    expect(r.host.hostSets).toBe(sets + 2);
    expect([children.length, r.context.nodes.length]).toEqual([built, nodes]);
    expect(fadeOf(tint).gain.automation).toEqual([]);
    expect(r.waiting).toEqual([]);
    expect(r.host.routes).toEqual([true]);
  });
});

describe('a refusal', () => {
  const missing = host({ kind: 'nope' as FakeSlotSpec['kind'] });

  it('throws for a child kind the registry lacks before anything is touched', () => {
    const r = rig(host({ kind: 'tint' }));
    const tint = children.at(-1)!;
    const [built, sets] = [children.length, r.host.hostSets];
    expect(() => r.stage().set(missing)).toThrow('part "lead": no insert kind "nope"');
    expect(() => r.chain.check([missing])).toThrow('no insert kind "nope"');
    expect([children.length, r.host.hostSets, tint.disposed]).toEqual([built, sets, 0]);
    expect(wired(r)).toEqual([tint]);
  });

  it('builds nothing for a chain whose host holds one', () => {
    const before = hosts.length;
    expect(() => rig(missing)).toThrow('no insert kind "nope"');
    expect(hosts.length).toBe(before);
  });
});

describe('param', () => {
  it('reads slot.<f> on the live child, any other field on the host, and an empty slot as none', () => {
    const r = rig(host({ kind: 'tint' }));
    const tint = children.at(-1)!;
    const own = r.stage().param!('level') as FakeHandle;
    expect(own.owner).toBe(r.host as unknown as FakeChild);
    expect(r.stage().param!('slot.level')).toMatchObject({ owner: tint, field: 'level' });
    r.stage().set(host(null));
    expect(r.stage().param!('slot.level')).toBeUndefined();
  });
});

describe('a reorder', () => {
  it('moves the host with its child, rebuilding neither', () => {
    const registry = { ...SLOT_KINDS, ...TEST_KINDS } as InsertRegistry;
    const context = new FakeContext();
    const head = context.createGain() as unknown as AudioNode;
    const spec = host({ kind: 'tint' });
    const chain = createInsertChain(context.asAudioContext(), head, [spec, scale(1)], {
      registry,
      owner: 'lead',
      later: (run) => run(),
    });
    const [wrapped, other] = chain.stages;
    const tint = children.at(-1)!;
    const built = [children.length, hosts.length];
    chain.set([scale(1), spec], () => {});
    expect(chain.stages).toEqual([other, wrapped]);
    expect(chain.stages[1]).toBe(wrapped);
    expect([children.length, hosts.length]).toEqual(built);
    expect([tint.disposed, hosts.at(-1)!.hostDisposed]).toEqual([0, 0]);
    expect(targets(hosts.at(-1)!.send)).toContain(fake(tint.input));
  });
});

describe('a dispose', () => {
  /** Every edge out of a child or its fade, and how often each was disposed. */
  const leftovers = (list: FakeChild[], fades: FakeGain[]) => ({
    edges: [...list.map((c) => fake(c.output)), ...fades].flatMap((n) => n.outbound),
    disposed: list.map((c) => c.disposed),
  });

  it('takes every child, live and leaving, with the host mid-fade; the late landing does nothing', () => {
    const r = rig(host({ kind: 'tint' }));
    const tint = children.at(-1)!;
    r.stage().set(host({ kind: 'tone' }));
    const tone = children.at(-1)!;
    const fades = [fadeOf(tint), fadeOf(tone)];
    r.chain.dispose();
    expect(leftovers([tint, tone], fades)).toEqual({ edges: [], disposed: [1, 1] });
    expect(r.host.hostDisposed).toBe(1);
    expect(() => r.settle()).not.toThrow();
    expect([tint.disposed, tone.disposed]).toEqual([1, 1]);
  });

  it('takes them too when the chain drops the host mid-fade', () => {
    const r = rig(host({ kind: 'tint' }));
    const tint = children.at(-1)!;
    r.stage().set(host(null));
    const fades = [fadeOf(tint)];
    r.chain.set([], () => {});
    expect(leftovers([tint], fades)).toEqual({ edges: [], disposed: [1] });
    expect(() => r.settle()).not.toThrow();
    expect(tint.disposed).toBe(1);
  });
});

describe('the live child', () => {
  it('is read through the host: the newest child through a swap, none when empty', () => {
    const r = rig();
    expect(slotChild(r.stage())).toBeUndefined();
    r.stage().set(host({ kind: 'tint' }));
    const tint = children.at(-1)!;
    expect(slotChild(r.stage())).toBe(tint);
    // A stage that is not a host's has none.
    expect(slotChild(tint)).toBeUndefined();
    r.stage().set(host({ kind: 'tone' }));
    const tone = children.at(-1)!;
    expect(slotChild(r.stage())).toBe(tone);
    r.stage().set(host(null));
    expect(slotChild(r.stage())).toBeUndefined();
  });
});
