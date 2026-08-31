/**
 * The desk is data, so the invariants the routing relies on are pinned here:
 * every send names a return that exists, every value is in the range its
 * parameter clamps to, and -- record §6 -- exactly one plate is instantiated.
 */
import { describe, expect, it } from 'vitest';

import { BLOCK } from './__fixtures__/fakeAudioNodes';
import { DEFAULT_STRIP, MIX, RETURNS, RETURN_NAMES, stripFor } from './mix';
import { SPACES } from './reverbSpace';

const strips = Object.entries(MIX);
const returns = Object.entries(RETURNS);

describe('MIX', () => {
  it('names at least the four parts the generative bed will create', () => {
    expect(Object.keys(MIX)).toEqual(expect.arrayContaining(['kick', 'hat', 'arp', 'drone']));
  });

  it('keeps every fader inside the worklet gain range, 0..4', () => {
    for (const [name, strip] of strips) {
      expect(strip.level, `${name}.level`).toBeGreaterThanOrEqual(0);
      expect(strip.level, `${name}.level`).toBeLessThanOrEqual(4);
    }
  });

  it('keeps every pan inside -1..1', () => {
    for (const [name, strip] of strips) {
      expect(Math.abs(strip.pan), `${name}.pan`).toBeLessThanOrEqual(1);
    }
  });

  it('sends only to returns that exist, at amounts inside 0..1', () => {
    for (const [name, strip] of strips) {
      for (const [target, amount] of Object.entries(strip.sends)) {
        expect(RETURN_NAMES, `${name}.sends.${target}`).toContain(target);
        expect(amount, `${name}.sends.${target}`).toBeGreaterThanOrEqual(0);
        expect(amount, `${name}.sends.${target}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('exercises every send state: dry, delay-only, reverb', () => {
    const dry = strips.filter(([, s]) => Object.keys(s.sends).length === 0);
    const delayOnly = strips.filter(([, s]) => 'echo' in s.sends && !('room' in s.sends));
    const reverb = strips.filter(([, s]) => 'room' in s.sends);
    expect(dry.length).toBeGreaterThan(0);
    expect(delayOnly.length).toBeGreaterThan(0);
    expect(reverb.length).toBeGreaterThan(0);
  });
});

describe('RETURNS', () => {
  it('instantiates exactly one plate, and it is the hall', () => {
    const plates = returns.filter(([, r]) => r.kind === 'reverb');
    expect(plates).toHaveLength(1);
    expect(plates[0]?.[1]).toMatchObject({ space: SPACES.hall });
  });

  it('has one delay, long enough for the loop and short enough for its line', () => {
    const delays = returns.filter(([, r]) => r.kind === 'delay');
    expect(delays).toHaveLength(1);
    for (const [name, r] of delays) {
      if (r.kind !== 'delay') continue;
      expect(r.delayTime, `${name}.delayTime`).toBeGreaterThanOrEqual(BLOCK / 48000);
      expect(r.delayTime, `${name}.delayTime`).toBeLessThanOrEqual(5);
      expect(r.feedback, `${name}.feedback`).toBeLessThanOrEqual(0.95);
      expect(r.damp, `${name}.damp`).toBeGreaterThan(0);
    }
  });

  it('keeps every return level inside 0..1', () => {
    for (const [name, r] of returns) {
      expect(r.level, `${name}.level`).toBeGreaterThanOrEqual(0);
      expect(r.level, `${name}.level`).toBeLessThanOrEqual(1);
    }
  });
});

describe('stripFor', () => {
  it('returns the named strip, or unity-centred-dry for a part the mix does not know', () => {
    expect(stripFor(MIX, 'drone')).toBe(MIX.drone);
    expect(stripFor(MIX, 'nobody')).toBe(DEFAULT_STRIP);
    expect(DEFAULT_STRIP).toEqual({ level: 1, pan: 0, sends: {} });
  });
});
