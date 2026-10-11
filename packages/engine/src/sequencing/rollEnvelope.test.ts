/**
 * The Roll's clip envelopes (windsor#701): `envelopeValueAt` over a loop,
 * on the song lanes' curve; the check refusing each field out of its range;
 * and a roll with envelopes playing exactly the notes it plays without them.
 */
import { describe, expect, it } from 'vitest';

import { valueAt } from '../automation/automationEvaluate';
import type { AutomationPoint } from '../automation/automationLane';
import type { PartTickEvent } from './regionGate';
import { ROLL_ENVELOPES_MAX, type RollEnvelope } from './rollEnvelope';
import { ROLL_ENVELOPE_POINTS_MAX, ROLL_ENVELOPE_ROW } from './rollEnvelopeTables';
import { envelopeValueAt } from './rollEnvelopeValue';
import {
  ROLL_LOOP_TICKS_MAX,
  RollSequencer,
  assertRollConfig,
  type RollSequencerConfig,
} from './rollSequencer';
import { DIVISORS } from './scheduler';

const point = (tick: number, value: number, bend = 0): AutomationPoint => ({ tick, value, bend });

const envelope = (points: AutomationPoint[], on = true): RollEnvelope => ({
  target: 'filter.cutoff',
  on,
  points,
});

/** Up from −0.5 at tick 24 to 1 at 72, bowed; down to 0 at 120. */
const SWEEP = envelope([point(24, -0.5, 0.6), point(72, 1), point(120, 0)]);

describe('envelopeValueAt (windsor#701)', () => {
  it('holds the first point before it and the last after it, tick 0 included', () => {
    expect(envelopeValueAt(SWEEP, 0)).toBe(-0.5);
    expect(envelopeValueAt(SWEEP, 23)).toBe(-0.5);
    expect(envelopeValueAt(SWEEP, 121)).toBe(0);
    expect(envelopeValueAt(envelope([point(0, 0.25), point(48, 1)]), 0)).toBe(0.25);
  });

  it('reads a point exactly on its tick', () => {
    expect(envelopeValueAt(SWEEP, 24)).toBe(-0.5);
    expect(envelopeValueAt(SWEEP, 72)).toBe(1);
    expect(envelopeValueAt(SWEEP, 120)).toBe(0);
  });

  it("follows a bent segment exactly as a song lane's valueAt does", () => {
    for (const tick of [30, 47.5, 60, 96]) {
      expect(envelopeValueAt(SWEEP, tick)).toBe(valueAt(ROLL_ENVELOPE_ROW, SWEEP.points, tick));
    }
    // Bowed up: past the straight line's midpoint value at the segment's midpoint.
    expect(envelopeValueAt(SWEEP, 48)).toBeGreaterThan(0.25);
  });

  it('never reads a point at or past a shorter loop: the last point inside it holds', () => {
    expect(envelopeValueAt(SWEEP, 95, 96)).toBe(1);
    // The point at 72 is the loop's end: the one at 24 is the last heard.
    expect(envelopeValueAt(SWEEP, 71, 72)).toBe(-0.5);
    expect(envelopeValueAt(SWEEP, 48, 96)).toBe(envelopeValueAt(SWEEP, 48));
    expect(envelopeValueAt(SWEEP, 10, 24)).toBe(0);
  });

  it('reads 0 with no points, and 0 switched off', () => {
    expect(envelopeValueAt(envelope([]), 0)).toBe(0);
    expect(envelopeValueAt(envelope(SWEEP.points as AutomationPoint[], false), 72)).toBe(0);
  });
});

describe('the roll check with envelopes (windsor#701)', () => {
  const config = (envelopes: unknown): RollSequencerConfig =>
    ({ loopTicks: 96, notes: [], envelopes }) as RollSequencerConfig;
  const targets = [
    'filter.cutoff',
    'filter.resonance',
    'ops.0.level',
    'lfo.rate',
    'macros.7.value',
  ];
  const many = (count: number): RollEnvelope[] =>
    targets.slice(0, count).map((target) => ({ ...SWEEP, target }) as RollEnvelope);

  it('caps the points at one per sixteenth across the longest loop', () => {
    expect(ROLL_ENVELOPE_POINTS_MAX).toBe(ROLL_LOOP_TICKS_MAX / DIVISORS.sixteenth);
  });

  it('passes envelopes in range, fractional ticks included, and none at all', () => {
    expect(() => assertRollConfig(config(many(ROLL_ENVELOPES_MAX)))).not.toThrow();
    const fractional = envelope([point(0.5, -1, -1), point(ROLL_LOOP_TICKS_MAX - 1, 1, 1)]);
    expect(() => assertRollConfig(config([fractional]))).not.toThrow();
    expect(() => assertRollConfig(config(undefined))).not.toThrow();
  });

  it('refuses each field out of its range', () => {
    const refused = (envelopes: unknown, message: RegExp): void =>
      expect(() => assertRollConfig(config(envelopes))).toThrow(message);
    refused(many(ROLL_ENVELOPES_MAX + 1), /at most 4/);
    refused([SWEEP, SWEEP], /repeats/);
    refused([{ ...SWEEP, target: 'strip.level' }], /not a VoiceTargetPath/);
    refused([envelope([point(-1, 0)])], /tick/);
    refused([envelope([point(ROLL_LOOP_TICKS_MAX, 0)])], /tick/);
    refused([envelope([point(4, 0), point(4, 1)])], /after the point before/);
    refused([envelope([point(0, 1.5)])], /value/);
    refused([envelope([point(0, Number.NaN)])], /value/);
    refused([envelope([point(0, 0, -2)])], /bend/);
    const crowded = Array.from({ length: ROLL_ENVELOPE_POINTS_MAX + 1 }, (_, i) => point(i, 0));
    refused([envelope(crowded)], /points must be a list/);
  });
});

describe('a roll with envelopes plays its notes as it did (windsor#701)', () => {
  it('starts and releases the same notes, tick for tick', () => {
    const notes = [
      { tick: 0, ticks: 24, pitch: 60 },
      { tick: 48, ticks: 96, pitch: 67, velocity: 0.5 },
    ];
    const at = (tick: number): PartTickEvent => ({
      tick,
      step: tick,
      bar: 0,
      tickInBar: tick,
      seconds: tick,
      secondsPerTick: 1,
      time: tick,
      chord: null,
      regionIndex: 0,
    });
    const play = (roll: RollSequencer): unknown[] =>
      Array.from({ length: 4 * 96 }, (_, tick) => roll.handleTick(at(tick)));
    const bare = new RollSequencer({ loopTicks: 96, notes });
    const enveloped = new RollSequencer({ loopTicks: 96, notes, envelopes: [SWEEP] });
    expect(play(enveloped)).toEqual(play(bare));
  });
});
