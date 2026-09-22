/**
 * The desk is data, so the invariants the routing relies on are pinned here:
 * every send names a return that exists, every value is in the range its
 * parameter clamps to, and -- record §6 -- exactly one plate is instantiated.
 */
import { describe, expect, it } from 'vitest';

import { BLOCK } from './__fixtures__/fakeAudioNodes';
import { DEFAULT_STRIP, MIX, RETURNS, RETURN_NAMES, stripFor } from './mix';
import { SPACES } from './reverbSpace';
import { LOW_CUT_MAX_HZ, LOW_CUT_MIN_HZ } from './audioConstants';

const strips = Object.entries(MIX);
const returns = Object.entries(RETURNS);

describe('MIX', () => {
  it('names the SFX strips only: music parts carry their own strip in the song (#597)', () => {
    expect(Object.keys(MIX).sort()).toEqual(['place', 'ui']);
  });

  it('keeps every fader inside the worklet gain range, 0..4', () => {
    for (const [name, strip] of strips) {
      expect(strip.level, `${name}.level`).toBeGreaterThanOrEqual(0);
      expect(strip.level, `${name}.level`).toBeLessThanOrEqual(4);
    }
  });

  it('keeps every low cut inside its range (#640)', () => {
    for (const [name, strip] of strips) {
      expect(strip.lowCut, `${name}.lowCut`).toBeGreaterThanOrEqual(LOW_CUT_MIN_HZ);
      expect(strip.lowCut, `${name}.lowCut`).toBeLessThanOrEqual(LOW_CUT_MAX_HZ);
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

  it('exercises a dry SFX strip and one with a send', () => {
    const dry = strips.filter(([, s]) => Object.keys(s.sends).length === 0);
    const sent = strips.filter(([, s]) => Object.keys(s.sends).length > 0);
    expect(dry.length).toBeGreaterThan(0);
    expect(sent.length).toBeGreaterThan(0);
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
    expect(stripFor(MIX, 'ui')).toBe(MIX.ui);
    expect(stripFor(MIX, 'nobody')).toBe(DEFAULT_STRIP);
    expect(DEFAULT_STRIP).toEqual({
      level: 1,
      pan: 0,
      lowCut: LOW_CUT_MIN_HZ,
      sends: {},
      inserts: [],
    });
  });
});
