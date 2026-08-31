/**
 * `makeArrangement` (issue #75, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §4–§5): never
 * throws, clamps and defaults with corrections reported, drops what cannot
 * play, round-trips, and yields the metronome fallback when nothing usable
 * survives.
 */
import { describe, expect, it } from 'vitest';

import type { Arrangement } from './arrangement';
import { FALLBACK_ARRANGEMENT } from './arrangement';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ArrangementPlayer, type PlayablePart } from './arrangementPlayer';
import { DEFAULT_STRIP, MIX, stripFor } from './mix';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from './scheduler';

const silentPart = (): PlayablePart => ({
  noteOn: () => 0,
  noteOffByNote: () => {},
  trigger: () => 0,
  setPatch: () => {},
  allNotesOff: () => {},
});

/** Building and running the player is the "usable" proof: no constructor throws. */
function play(arrangement: Arrangement): void {
  const parts = { kick: silentPart(), hat: silentPart(), arp: silentPart(), drone: silentPart() };
  const transport = new TickTransport();
  const player = new ArrangementPlayer(transport, parts, arrangement);
  for (let i = 0; i < TICKS_PER_BAR; i++) transport.advance(0);
  player.dispose();
}

const JUNK: Array<[string, unknown]> = [
  ['null', null],
  ['a number', 42],
  ['a string', 'arrangement'],
  ['an array', [1, 2, 3]],
  ['an empty object', {}],
  ['wrong types throughout', { seed: 'x', bpm: 'fast', key: 3, kick: { preset: 9 } }],
  ['a truncated document', { kick: { part: 'kick', preset: 'kick' }, hat: { preset: 'hat' } }],
  [
    'out-of-range numbers',
    {
      bpm: 1e9,
      kick: {
        preset: 'kick',
        note: -5,
        velocity: 9,
        hold: -1,
        driver: { steps: 0, divisor: 7, pulses: { min: 9, max: 2, start: 99 } },
      },
    },
  ],
  ['a prototype-chain preset name', { kick: { preset: 'toString' } }],
  ['unknown keys everywhere', { wat: 1, kick: { preset: 'kick', wobble: 2, driver: { flux: 3 } } }],
];

describe('makeArrangement never throws', () => {
  it.each(JUNK)('yields a playable arrangement from %s', (_name, raw) => {
    const result = makeArrangement(raw);
    expect(() => play(result.document)).not.toThrow();
  });
});

describe('corrections are reported', () => {
  it('names every clamp by path', () => {
    const result = makeArrangement({ kick: { preset: 'kick', velocity: 9 }, bpm: 9999 });
    expect(result.usable).toBe(true);
    expect(result.corrections).toContain('kick.velocity: clamped 9 to 1');
    expect(result.corrections).toContain('bpm: clamped 9999 to 300');
  });

  it('names every dropped unknown key by path', () => {
    const result = makeArrangement({ wat: 1, kick: { preset: 'kick', wobble: 2 } });
    expect(result.corrections).toContain('wat: unknown key dropped');
    expect(result.corrections).toContain('kick.wobble: unknown key dropped');
  });

  it('replaces a divisor that does not divide the bar', () => {
    const result = makeArrangement({ drone: { preset: 'drone-sqr', driver: { divisor: 7 } } });
    expect(result.corrections.join('\n')).toMatch(/divisor: 7 does not divide the 96-tick bar/);
    expect(result.document.drone?.driver.divisor).toBe(96);
  });

  it('takes defaults for absent optional fields silently', () => {
    const result = makeArrangement({ kick: { part: 'kick', preset: 'kick' } });
    expect(result.usable).toBe(true);
    expect(result.corrections).toEqual([]);
    expect(result.document.kick?.driver.steps).toBe(16);
  });
});

describe('the fallback (record §4)', () => {
  it('is what nothing usable normalises to', () => {
    const result = makeArrangement(null);
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(isShippable(result)).toBe(false);
    expect(result.corrections.at(-1)).toMatch(/falling back to the metronome/);
  });

  it('is one non-generative part on a quarter-note pulse, no sends, no pitched parts', () => {
    const f = FALLBACK_ARRANGEMENT;
    expect(f.hat).toBeUndefined();
    expect(f.arp).toBeUndefined();
    expect(f.drone).toBeUndefined();
    expect('mix' in f).toBe(false);
    expect(f.kick.driver.divisor).toBe(DIVISORS.quarter);
    // min === max: the density LFO has nothing to modulate — not generative.
    expect(f.kick.driver.pulses.min).toBe(f.kick.driver.pulses.max);
    // pulses === steps: E(n, n) fires on every step — a plain pulse.
    expect(f.kick.driver.pulses.min).toBe(f.kick.driver.steps);
    // No sends: the click deliberately has no MIX strip, so it routes through
    // DEFAULT_STRIP — unity, centred, sends nothing — whatever the mix says.
    expect(Object.hasOwn(MIX, f.kick.part)).toBe(false);
    expect(stripFor(MIX, f.kick.part)).toBe(DEFAULT_STRIP);
    expect(DEFAULT_STRIP.sends).toEqual({});
  });

  it('clicks exactly once per quarter note, unvarying', () => {
    const transport = new TickTransport(FALLBACK_ARRANGEMENT.bpm);
    let triggers = 0;
    const clicker = { ...silentPart(), trigger: () => ++triggers };
    const player = new ArrangementPlayer(transport, { kick: clicker }, FALLBACK_ARRANGEMENT);
    for (let i = 0; i < 4 * TICKS_PER_BAR; i++) transport.advance(0);
    expect(triggers).toBe(16);
    player.dispose();
  });
});

describe('round-trip: normalise → serialise → normalise', () => {
  it('is equal and correction-free on the normalised object', () => {
    const messy = {
      seed: 204.4,
      bpm: 500,
      key: { root: 50, scale: 'dorian', weights: [4, 1] },
      kick: { preset: 'kick', velocity: 3, driver: { divisor: 5 } },
      arp: { preset: 'saw-arp', driver: { gate: 2, walk: 'sideways' } },
      mix: { kick: { level: 9 }, hat: { sends: { echo: 2 } } },
    };
    const first = makeArrangement(messy);
    expect(first.usable).toBe(true);
    expect(first.corrections.length).toBeGreaterThan(0);
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.document).toEqual(first.document);
    expect(second.corrections).toEqual([]);
    expect(second.dangling).toEqual([]);
  });

  it('holds on the fallback itself', () => {
    const again = makeArrangement(JSON.parse(JSON.stringify(FALLBACK_ARRANGEMENT)));
    expect(again.usable).toBe(true);
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(FALLBACK_ARRANGEMENT);
    // The click's strip is deliberately not in the MIX, so the fallback is
    // reported — one more way it can never quietly become the arrangement.
    expect(again.dangling).toEqual(['kick.part: the MIX defines no strip "click"']);
  });
});

describe('runtime inputs JSON cannot represent (self-review findings)', () => {
  it('never throws on BigInt or cyclic values in a field', () => {
    const bigint = makeArrangement({ kick: { preset: 'kick', velocity: 1n } });
    expect(bigint.document.kick?.velocity).toBe(0.8);
    expect(bigint.corrections.join('\n')).toMatch(/kick\.velocity/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => makeArrangement({ kick: { preset: 'kick', velocity: cyclic } })).not.toThrow();
    expect(() => makeArrangement(1n)).not.toThrow();
  });

  it('drops a later slot reusing an earlier slot part name', () => {
    const result = makeArrangement({
      kick: { part: 'kick', preset: 'kick' },
      hat: { part: 'kick', preset: 'hat' },
    });
    expect(result.usable).toBe(true);
    expect(result.document.kick).toBeDefined();
    expect(result.document.hat).toBeUndefined();
    expect(result.corrections.join('\n')).toMatch(
      /hat: part name "kick" is already used by kick — part dropped/,
    );
  });
});
