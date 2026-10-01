/**
 * A strip's Output moves its one dry edge (windsor#285 decision 3): Master
 * is the music bus, a group its input. A move fades the gate down, moves the
 * edge once the ramp has landed, and fades back up; a run of switches inside
 * the wait is one move to the last; Sidechain only closes the gate; a group
 * the song lacks plays on Master. The sends never move.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeGain } from '../__fixtures__/fakeAudioNodes';
import { STRIP, fake, installWorklet, rig, sources, targets } from '../__fixtures__/stripRig';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { DryTargets, PartStrip } from './channelStrip';
import { routePart } from './channelStrip';
import type { ChannelStrip } from './mix';
import { RETURNS } from './mix';
import { createReturns } from './returnBus';

const undo = installWorklet();
afterAll(undo);

/** A deferred re-wire held until the test runs it, so the state inside the fade can be read. */
function heldDefer(): {
  defer: (run: () => void, seconds: number) => void;
  run: () => void;
  waits: number[];
} {
  const queue: (() => void)[] = [];
  const waits: number[] = [];
  return {
    defer: (run, seconds) => {
      queue.push(run);
      waits.push(seconds);
    },
    run: () => {
      for (const next of queue.splice(0)) next();
    },
    waits,
  };
}

async function build(strip: Partial<ChannelStrip> = {}) {
  const { context, part, dry } = await rig();
  const ctx = context.asAudioContext();
  const returns = createReturns(ctx, RETURNS, dry);
  const groups = new Map([
    [1, ctx.createGain() as AudioNode],
    [2, ctx.createGain() as AudioNode],
  ]);
  const routeTargets: DryTargets = { master: dry, group: (id) => groups.get(id) };
  const held = heldDefer();
  const routed = routePart(part, { ...STRIP, ...strip }, returns, routeTargets, {
    defer: held.defer,
  });
  return { context, dry, groups, held, strip: routed };
}

const gateOf = (strip: PartStrip): FakeGain => targets(strip.head)[0] as FakeGain;
const dryTargets = (strip: PartStrip) => targets(strip.rotation.output);
const sendTargets = (strip: PartStrip) => [...strip.sends.values()].map((s) => targets(s));

describe("a strip's Output", () => {
  it('builds on the group it names, and on Master for a group the song lacks', async () => {
    const grouped = await build({ output: { group: 2 } });
    expect(dryTargets(grouped.strip)).toEqual([fake(grouped.groups.get(2)!)]);
    expect(grouped.strip.output).toEqual({ group: 2 });
    const missing = await build({ output: { group: 7 } });
    expect(dryTargets(missing.strip)).toEqual([fake(missing.dry)]);
    expect(missing.strip.output).toBe('master');
  });

  it('fades the gate down, moves the one dry edge once the ramp lands, and fades back up', async () => {
    const { strip, dry, groups, held, context } = await build();
    const sends = sendTargets(strip);
    (context as FakeContext).currentTime = 2;
    expect(strip.setOutput({ group: 1 })).toBe(true);
    const gate = gateOf(strip);
    // Inside the fade: the gate is down and the edge has not moved.
    expect(gate.gain.value).toBe(0);
    expect(gate.gain.automation.at(-1)).toEqual({
      call: 'linearRampToValueAtTime',
      value: 0,
      time: 2 + INSERT_FADE_SECONDS,
    });
    expect(held.waits).toEqual([INSERT_FADE_SECONDS]);
    expect(dryTargets(strip)).toEqual([fake(dry)]);
    held.run();
    expect(dryTargets(strip)).toEqual([fake(groups.get(1)!)]);
    expect(sources(groups.get(1)!)).toEqual([fake(strip.rotation.output)]);
    expect(sources(dry)).not.toContain(fake(strip.rotation.output));
    expect(gate.gain.value).toBe(1);
    expect(gate.gain.automation.at(-1)).toMatchObject({
      call: 'linearRampToValueAtTime',
      value: 1,
    });
    expect(sendTargets(strip)).toEqual(sends);
    expect(strip.destination).toBe(groups.get(1));
  });

  it('makes a run of switches inside the wait one move, to the last', async () => {
    const { strip, groups, held } = await build();
    strip.setOutput({ group: 1 });
    strip.setOutput({ group: 2 });
    expect(held.waits).toHaveLength(1);
    held.run();
    expect(dryTargets(strip)).toEqual([fake(groups.get(2)!)]);
    expect(sources(groups.get(1)!)).toEqual([]);
    expect(gateOf(strip).gain.value).toBe(1);
  });

  it('moves nothing for Master while on Master, and Sidechain leaves the edge where it was', async () => {
    const { strip, dry, groups, held } = await build({ output: { group: 1 } });
    strip.setOutput({ group: 1 });
    expect(held.waits).toEqual([]);
    strip.setOutput('sidechain');
    expect(held.waits).toEqual([]);
    expect(dryTargets(strip)).toEqual([fake(groups.get(1)!)]);
    expect(gateOf(strip).gain.value).toBe(0);
    strip.setOutput('master');
    held.run();
    expect(dryTargets(strip)).toEqual([fake(dry)]);
    expect(gateOf(strip).gain.value).toBe(1);
  });

  it('plays a group the song lacks on Master, and says so', async () => {
    const { strip, dry, held } = await build({ output: { group: 1 } });
    expect(strip.setOutput({ group: 9 })).toBe(false);
    expect(strip.output).toBe('master');
    held.run();
    expect(dryTargets(strip)).toEqual([fake(dry)]);
  });

  it('drops a move still waiting when the strip is disposed, leaving no edge', async () => {
    const { strip, dry, groups, held } = await build();
    strip.setOutput({ group: 1 });
    strip.dispose();
    held.run();
    expect(dryTargets(strip)).toEqual([]);
    expect(sources(groups.get(1)!)).toEqual([]);
    expect(sources(dry).filter((n) => n === fake(strip.rotation.output))).toEqual([]);
  });
});
