import { describe, expect, it } from 'vitest';

import { armKey, ccKey, pickupStep, reachesPosition } from './ccPickup';

const from = (value: number, device: string | null = 'Keys', channel = 1) => ({
  device,
  channel,
  value,
});

describe('reachesPosition', () => {
  it('reaches the nearest whole step to a real position', () => {
    expect(reachesPosition(63.6, 64, null)).toBe(true);
    expect(reachesPosition(63.4, 64, null)).toBe(false);
  });

  it('crosses only from a value heard since arming', () => {
    expect(reachesPosition(50, 60, 40)).toBe(true);
    expect(reachesPosition(50, 40, 60)).toBe(true);
    expect(reachesPosition(50, 60, 55)).toBe(false);
    expect(reachesPosition(50, 60, null)).toBe(false);
  });

  it('has nothing to cross when min equals max', () => {
    expect(reachesPosition(null, 3, null)).toBe(true);
  });
});

describe('pickupStep', () => {
  it('waits, moves the marker, then picks up on a crossing and stays picked', () => {
    const first = pickupStep(undefined, from(10), 50, 'pickup');
    expect(first.apply).toBe(false);
    expect(first.state).toMatchObject({ heard: 10, since: 10, picked: false });
    const second = pickupStep(first.state, from(70), 50, 'pickup');
    expect(second.apply).toBe(true);
    const third = pickupStep(second.state, from(5), 50, 'pickup');
    expect(third.apply).toBe(true);
  });

  it('applies every value under Jump', () => {
    expect(pickupStep(undefined, from(10), 50, 'jump').apply).toBe(true);
  });

  it('after arming, needs a value that reaches, or two that cross', () => {
    const picked = pickupStep(undefined, from(50), 50, 'pickup').state;
    const armed = armKey(picked);
    expect(armed).toMatchObject({ heard: 50, since: null, picked: false });
    expect(pickupStep(armed, from(100), 30, 'pickup').apply).toBe(false);
  });

  it('keys a device name and a channel together', () => {
    expect(ccKey('Keys', 1)).not.toBe(ccKey('Keys', 2));
    expect(ccKey('Keys', 1)).not.toBe(ccKey('Pads', 1));
    expect(ccKey(null, 1)).not.toBe(ccKey('null', 1));
  });
});
