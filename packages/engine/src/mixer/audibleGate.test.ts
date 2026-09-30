/**
 * The audible gate (windsor#154): open only while the part is routed to the
 * master, unmuted and not soloed out; a change ramps like the output switch,
 * a solo set before anything plays lands at once, and a repeat schedules
 * nothing.
 */
import { describe, expect, it } from 'vitest';

import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeGain } from '../__fixtures__/fakeAudioNodes';
import { STRIP } from '../__fixtures__/stripRig';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { AudibleGate } from './audibleGate';
import { createAudibleGate } from './audibleGate';
import type { ChannelStrip } from './mix';

function gate(strip: Partial<ChannelStrip> = {}): { gate: AudibleGate; gain: FakeGain['gain'] } {
  const context = new FakeContext();
  context.currentTime = 1;
  const built = createAudibleGate(context.asAudioContext(), { ...STRIP, ...strip });
  return { gate: built, gain: (built.node as unknown as FakeGain).gain };
}

describe('the audible gate', () => {
  it('is open for a part on the master, and built closed when the strip is muted', () => {
    expect(gate().gain.value).toBe(1);
    const muted = gate({ mute: true });
    expect(muted.gain.value).toBe(0);
    expect(muted.gate.mute).toBe(true);
    expect(gate({ output: 'sidechain' }).gain.value).toBe(0);
  });

  it('ramps a mute in and out over the insert fade, and schedules nothing for a repeat', () => {
    const { gate: g, gain } = gate();
    g.setMute(true);
    expect(gain.automation).toEqual([
      { call: 'cancelScheduledValues', value: 1, time: 1 },
      { call: 'setValueAtTime', value: 1, time: 1 },
      { call: 'linearRampToValueAtTime', value: 0, time: 1 + INSERT_FADE_SECONDS },
    ]);
    g.setMute(true);
    expect(gain.automation).toHaveLength(3);
    g.setMute(false);
    expect(gain.value).toBe(1);
    expect(gain.automation.at(-1)).toMatchObject({ call: 'linearRampToValueAtTime', value: 1 });
  });

  it('stays closed while any of output, mute and solo closes it', () => {
    const { gate: g, gain } = gate();
    g.setOutput('sidechain');
    g.setMute(true);
    g.setOutput('master');
    expect(gain.value).toBe(0);
    g.setSoloedOut(true);
    g.setMute(false);
    expect(gain.value).toBe(0);
    g.setSoloedOut(false);
    expect(gain.value).toBe(1);
  });

  it('sets a solo at once when asked for no ramp', () => {
    const { gate: g, gain } = gate();
    g.setSoloedOut(true, 0);
    expect(g.soloedOut).toBe(true);
    expect(gain.automation).toEqual([
      { call: 'cancelScheduledValues', value: 1, time: 1 },
      { call: 'setValueAtTime', value: 0, time: 1 },
    ]);
    g.setSoloedOut(true, 0);
    expect(gain.automation).toHaveLength(2);
  });
});
