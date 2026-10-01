/**
 * The knob handle (windsor#344): one lane value written to several params,
 * engaged from a hold or schedule until its release, which gives the params
 * back to the knob's value.
 */
import { describe, expect, it } from 'vitest';

import { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { knobHandle } from './automationHandles';

function twoParams(resting = 0.4): {
  a: FakeParam;
  b: FakeParam;
  handle: ReturnType<typeof knobHandle>;
} {
  const a = new FakeParam(1);
  const b = new FakeParam(1);
  const handle = knobHandle({
    params: [a, b] as unknown as AudioParam[],
    write: (value) => [value, -value],
    resting: () => resting,
  });
  return { a, b, handle };
}

describe('knobHandle', () => {
  it('writes each param its own value, as a ramp or a set', () => {
    const { a, b, handle } = twoParams();
    handle.schedule(0.5, 1, 'ramp');
    handle.schedule(0.25, 2, 'set');
    expect(a.automation).toEqual([
      { call: 'linearRampToValueAtTime', value: 0.5, time: 1 },
      { call: 'setValueAtTime', value: 0.25, time: 2 },
    ]);
    expect(b.automation).toEqual([
      { call: 'linearRampToValueAtTime', value: -0.5, time: 1 },
      { call: 'setValueAtTime', value: -0.25, time: 2 },
    ]);
  });

  it('holds by cancelling from the time and setting there', () => {
    const { a, handle } = twoParams();
    handle.hold(0.3, 4);
    expect(a.automation).toEqual([
      { call: 'cancelScheduledValues', value: 1, time: 4 },
      { call: 'setValueAtTime', value: 0.3, time: 4 },
    ]);
  });

  it('is engaged from a hold or a schedule until its release, which restores the knob', () => {
    const { a, handle } = twoParams(0.4);
    expect(handle.engaged).toBe(false);
    handle.hold(0.3, 0);
    expect(handle.engaged).toBe(true);
    handle.release(2);
    expect(handle.engaged).toBe(false);
    expect(a.automation.slice(-2)).toEqual([
      { call: 'cancelScheduledValues', value: 0.3, time: 2 },
      { call: 'setValueAtTime', value: 0.4, time: 2 },
    ]);
    handle.schedule(0.1, 3, 'ramp');
    expect(handle.engaged).toBe(true);
  });
});
