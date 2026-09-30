/**
 * The desk is data, so the invariants the routing relies on are pinned here:
 * every send names a bus that exists, every value is in the range its
 * parameter clamps to, and the two send buses hold what the returns ran.
 */
import { describe, expect, it } from 'vitest';

import { BLOCK } from '../__fixtures__/fakeAudioNodes';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import { DEFAULT_PLATE_REVERB } from '../inserts/plateReverbInsert';
import { DEFAULT_STRIP, MIX, RETURNS, RETURN_NAMES, onSendBus, stripFor } from './mix';
import { SPACES } from './reverbSpace';
import { LOW_CUT_MAX_HZ, LOW_CUT_MIN_HZ } from '../audioConstants';

const strips = Object.entries(MIX);
const returns = Object.entries(RETURNS);

describe('MIX', () => {
  it('names the aux strips only: music parts carry their own strip in the song (#597)', () => {
    expect(Object.keys(MIX).sort()).toEqual(['audition', 'ui']);
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

  it('sends only to buses that exist, at amounts inside 0..1', () => {
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
  it('is Send A and Send B, and nothing else (windsor#172)', () => {
    expect(RETURN_NAMES).toEqual(['a', 'b']);
  });

  it('holds the hall plate on Send A at 0.90 and the echo on Send B at 0.60, both fully wet', () => {
    expect(RETURNS.a).toEqual({
      level: 0.9,
      inserts: [{ ...DEFAULT_PLATE_REVERB, ...SPACES.hall, mix: 1 }],
    });
    expect(RETURNS.b).toEqual({ level: 0.6, inserts: [{ ...DEFAULT_ECHO, mix: 1 }] });
  });

  it("keeps the old echo return's line, long enough for the loop and short enough for its line", () => {
    const [echo] = RETURNS.b.inserts;
    if (echo?.kind !== 'echo') throw new Error('Send B holds no Echo');
    expect(echo).toMatchObject({ delayTime: 0.28, feedback: 0.3, damp: 3200 });
    expect(echo.delayTime).toBeGreaterThanOrEqual(BLOCK / 48000);
    expect(echo.delayTime).toBeLessThanOrEqual(5);
    expect(echo.feedback).toBeLessThanOrEqual(0.95);
  });

  it('keeps every bus level inside 0..1', () => {
    for (const [name, r] of returns) {
      expect(r.level, `${name}.level`).toBeGreaterThanOrEqual(0);
      expect(r.level, `${name}.level`).toBeLessThanOrEqual(1);
    }
  });
});

describe('onSendBus', () => {
  it('starts a Plate reverb or an Echo fully wet, and any other kind at its defaults', () => {
    expect(onSendBus(DEFAULT_PLATE_REVERB)).toEqual({ ...DEFAULT_PLATE_REVERB, mix: 1 });
    expect(onSendBus(DEFAULT_ECHO)).toEqual({ ...DEFAULT_ECHO, mix: 1 });
    expect(onSendBus(DEFAULT_CHORUS)).toBe(DEFAULT_CHORUS);
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
