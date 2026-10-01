/**
 * The strip's lane handles (windsor#344): the fader is the part's `gain`,
 * pan the rotation's four gains at `setPan`'s equal-power values, each send
 * its own gain. While a handle is engaged its knob records and does not
 * write; the release restores what the knob last set. No handle touches the
 * audible gate.
 */
import { afterAll, describe, expect, it } from 'vitest';

import type { FakeGain, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { STRIP, installWorklet, rig, sources } from '../__fixtures__/stripRig';
import { routePart } from './channelStrip';
import { RETURNS } from './mix';
import { createReturns } from './returnBus';
import { rotationGains } from './stereoRotate';

const undo = installWorklet();
afterAll(undo);

const param = (p: AudioParam): FakeParam => p as unknown as FakeParam;

async function strip() {
  const { context, part, dry } = await rig();
  const returns = createReturns(context.asAudioContext(), RETURNS, dry);
  return routePart(part, STRIP, returns, dry);
}

describe('the strip automation handles', () => {
  it('has a handle for the fader, the pan and each send, and none for anything else', async () => {
    const s = await strip();
    for (const field of ['level', 'pan', 'send.a', 'send.b']) {
      expect(s.automation(field)).toBeDefined();
    }
    for (const field of ['lowCut', 'send.c', 'mute', ''])
      expect(s.automation(field)).toBeUndefined();
  });

  it('writes the fader, the four rotation gains and the send gains', async () => {
    const s = await strip();
    s.automation('level')!.schedule(0.5, 1, 'ramp');
    s.automation('pan')!.schedule(-0.6, 1, 'ramp');
    s.automation('send.b')!.schedule(0.9, 1, 'set');
    expect(param(s.part.gain).automation).toEqual([
      { call: 'linearRampToValueAtTime', value: 0.5, time: 1 },
    ]);
    const g = rotationGains(-0.6);
    for (const key of ['ll', 'lr', 'rl', 'rr'] as const) {
      expect(param(s.rotation.gains[key].gain).automation).toEqual([
        { call: 'linearRampToValueAtTime', value: g[key], time: 1 },
      ]);
    }
    expect(param(s.sends.get('b')!.gain).automation).toEqual([
      { call: 'setValueAtTime', value: 0.9, time: 1 },
    ]);
    expect(param(s.sends.get('a')!.gain).automation).toEqual([]);
  });

  it('records a knob while its handle is engaged and restores it on release', async () => {
    const s = await strip();
    s.automation('level')!.hold(0.5, 0);
    s.automation('pan')!.hold(-1, 0);
    s.automation('send.a')!.hold(0.1, 0);
    s.setLevel(0.8);
    s.setPan(0.6);
    s.setSend('a', 0.7);
    expect(s.part.gain.value).toBe(0.5);
    expect(s.rotation.pan).toBe(0.6);
    expect(s.rotation.gains.rl.gain.value).toBeCloseTo(rotationGains(-1).rl, 12);
    expect(s.sends.get('a')!.gain.value).toBe(0.1);
    for (const field of ['level', 'pan', 'send.a']) s.automation(field)!.release(2);
    expect(s.part.gain.value).toBe(0.8);
    expect(s.rotation.gains.rl.gain.value).toBeCloseTo(rotationGains(0.6).rl, 12);
    expect(s.sends.get('a')!.gain.value).toBe(0.7);
    s.setLevel(0.3);
    expect(s.part.gain.value).toBe(0.3);
  });

  it('never touches the audible gate', async () => {
    const s = await strip();
    const gate = sources(s.rotation.input)[0] as FakeGain;
    for (const field of ['level', 'pan', 'send.a', 'send.b']) {
      s.automation(field)!.hold(0.2, 0);
      s.automation(field)!.release(1);
    }
    expect(gate.gain.automation).toEqual([]);
  });
});
