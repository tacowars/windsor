/**
 * Reordering a strip's inserts (#652): the live stages move rather than being
 * rebuilt, so a chorus keeps its delay contents and its LFO phase, and every
 * structural edit happens inside a fade, so the step it makes in the waveform
 * is inaudible. A run of arrow presses is one fade, and the last order wins.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { FakeGain } from '../__fixtures__/fakeAudioNodes';
import {
  NOW,
  STAGE_GAIN,
  STRIP,
  TEST_KINDS,
  boost,
  built,
  fake,
  installWorklet,
  rig,
  scale,
  sources,
  targets,
} from '../__fixtures__/stripRig';
import { routePart } from './channelStrip';
import { RETURNS } from './mix';
import { createReturns } from './returnBus';

const undo = installWorklet();
afterAll(undo);

describe('routePart insert reordering', () => {
  it('moves the live stages on a reorder rather than rebuilding them (#652)', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(
      part,
      { ...STRIP, inserts: [scale(STAGE_GAIN), boost(1)] },
      returns,
      dry,
      {
        registry: TEST_KINDS,
        defer: NOW,
      },
    );
    const [wasFirst, wasSecond] = strip.inserts as unknown as (typeof built)[number][];
    const madeBefore = built.length;

    strip.setInserts([boost(1), scale(STAGE_GAIN)]);

    // The same two objects, in the other order: nothing built, nothing disposed.
    expect(strip.inserts).toEqual([wasSecond, wasFirst]);
    expect(built.length).toBe(madeBefore);
    expect(wasFirst!.disposed + wasSecond!.disposed).toBe(0);
    expect(targets(strip.lowCut.output)).toEqual([fake(wasSecond!.input)]);
    expect(targets(wasSecond!.output)).toEqual([fake(wasFirst!.input)]);
    expect(strip.tail).toBe(wasFirst!.output);
    expect(sources(strip.head)).toEqual([fake(wasFirst!.output)]);
  });

  it('carries each spec’s settings to the stage it lands on (#652)', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const strip = routePart(part, { ...STRIP, inserts: [scale(0.25), scale(0.75)] }, returns, dry, {
      registry: TEST_KINDS,
      defer: NOW,
    });
    const [first, second] = strip.inserts;
    const gainOf = (i: number): number =>
      (strip.inserts[i]!.output as unknown as FakeGain).gain.value;

    strip.setInserts([scale(0.75), scale(0.25)]);

    // Two of one kind keep their identity in order; the settings swap over them.
    expect(strip.inserts).toEqual([first, second]);
    expect([gainOf(0), gainOf(1)]).toEqual([0.75, 0.25]);
  });

  it('fades down, re-wires in silence and fades back up (#652)', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const waiting: (() => void)[] = [];
    const strip = routePart(part, { ...STRIP, inserts: [scale(1), boost(1)] }, returns, dry, {
      registry: TEST_KINDS,
      defer: (run) => void waiting.push(run),
    });
    const gain = (strip.head as unknown as FakeGain).gain;
    const order = strip.inserts.map((i) => i.kind);
    gain.automation.length = 0;

    strip.setInserts([boost(1), scale(1)]);
    // The ramp is out, and nothing has moved yet.
    expect(gain.automation.map((a) => a.call)).toEqual([
      'cancelScheduledValues',
      'setValueAtTime',
      'linearRampToValueAtTime',
    ]);
    expect(gain.automation.at(-1)?.value).toBe(0);
    expect(gain.value).toBe(0);
    expect(strip.inserts.map((i) => i.kind)).toEqual(order);

    waiting.forEach((run) => run());
    expect(strip.inserts.map((i) => i.kind)).toEqual([...order].reverse());
    expect(gain.automation.at(-1)).toMatchObject({ call: 'linearRampToValueAtTime', value: 1 });
    expect(gain.value).toBe(1);
  });

  it('coalesces presses inside one fade: the last list wins, on one fade (#652)', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const waiting: (() => void)[] = [];
    const strip = routePart(part, { ...STRIP, inserts: [scale(1), boost(1)] }, returns, dry, {
      registry: TEST_KINDS,
      defer: (run) => void waiting.push(run),
    });
    const live = [...strip.inserts];
    const madeBefore = built.length;

    strip.setInserts([boost(1), scale(1)]);
    strip.setInserts([scale(1), boost(1)]);
    expect(waiting).toHaveLength(1);

    waiting.forEach((run) => run());
    expect(strip.inserts).toEqual(live);
    // Nothing was built or disposed: the coalesced list was the live order.
    expect(built.length).toBe(madeBefore);
    expect(live.every((stage) => (stage as unknown as (typeof built)[number]).disposed === 0)).toBe(
      true,
    );
  });

  it('drops a re-wire that is still waiting when the strip is disposed (#652 review)', async () => {
    const { context, part, dry } = await rig();
    const returns = createReturns(context.asAudioContext(), RETURNS, dry);
    const waiting: (() => void)[] = [];
    const strip = routePart(part, { ...STRIP, inserts: [scale(1)] }, returns, dry, {
      registry: TEST_KINDS,
      defer: (run) => void waiting.push(run),
    });
    const madeBefore = built.length;

    strip.setInserts([scale(1), boost(1)]);
    strip.dispose();

    // The callback fires into a graph that has gone: it must build nothing —
    // a chorus would leave its oscillators running — and must not throw.
    expect(() => waiting.forEach((run) => run())).not.toThrow();
    expect(built.length).toBe(madeBefore);
    expect(targets(part.output)).toEqual([]);
  });
});
