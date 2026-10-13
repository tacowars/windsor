import { describe, expect, it } from 'vitest';
import { fromDisplay } from '../automation/automationDisplay';
import type { AutomationTargetRow } from '../automation/automationLane';
import { SEQ_AUTOMATION_ROWS } from '../automation/automationSeqTables';
import { requireCatalogRow } from '../automation/automationTargets';
import { type CcRange, ccDefaultRange, ccPosition, ccValue, isCcMappableTarget } from './ccMapping';

const CUTOFF = requireCatalogRow('voice.filter.cutoff');
const LEVEL = requireCatalogRow('voice.ops.0.level');
const STRIP_LEVEL = requireCatalogRow('strip.level');
const RATIO = requireCatalogRow('voice.ops.0.ratio');
const DECAY = requireCatalogRow('voice.ops.0.env.decayTime');

const range = (min: number, max: number, inverted = false): CcRange => ({ min, max, inverted });

describe('ccValue: the record’s worked examples', () => {
  it('spreads the cutoff over 2–6 kHz in octaves: CC 64 is 3479.1 Hz', () => {
    const value = ccValue(CUTOFF, range(2000, 6000), 64);
    expect(value).toBeCloseTo(3479.1, 1);
    expect(Math.log2(value / 1000)).toBeCloseTo(1.7987, 4);
    expect(ccValue(CUTOFF, range(2000, 6000), 0)).toBe(2000);
    expect(ccValue(CUTOFF, range(2000, 6000), 127)).toBe(6000);
  });

  it('inverts an operator level over its full range: CC 0 is 1.00, CC 127 is 0.00', () => {
    expect(ccValue(LEVEL, range(0, 1, true), 0)).toBe(1);
    expect(ccValue(LEVEL, range(0, 1, true), 127)).toBe(0);
  });

  it('sweeps a decay from 0 geometrically up from the 1 ms floor, CC 0 the knob’s 0', () => {
    const full = ccDefaultRange(DECAY);
    expect(full.min).toBe(0);
    const decay = range(full.min, full.max);
    expect(ccValue(DECAY, decay, 0)).toBe(0);
    expect(ccValue(DECAY, decay, 1)).toBeCloseTo(fromDisplay(DECAY, 1 / 127), 12);
    expect(ccValue(DECAY, decay, 1)).toBeGreaterThan(DECAY.floor!);
    expect(ccValue(DECAY, decay, 127)).toBe(DECAY.max);
  });
});

/** A ratio (octaves), a linear, a dB and a log row, each with a range inside it. */
const ROWS: readonly (readonly [string, AutomationTargetRow, number, number, number])[] = [
  ['ratio', CUTOFF, 200, 8000, 1234],
  ['linear', LEVEL, 0.1, 0.9, 0.37],
  ['dB', STRIP_LEVEL, 0.01, 1.5, 0.5],
  ['log', RATIO, 0.5, 8, 3],
];

describe('ccValue and ccPosition on each kind of row', () => {
  it.each(ROWS)('a %s row round-trips a value inside the range', (_, row, min, max, v) => {
    for (const inverted of [false, true]) {
      const position = ccPosition(row, range(min, max, inverted), v)!;
      expect(position).toBeGreaterThan(0);
      expect(position).toBeLessThan(127);
      expect(ccValue(row, range(min, max, inverted), position)).toBeCloseTo(v, 9);
    }
  });

  it.each(ROWS)(
    'a %s row plays its ends at CC 0 and CC 127, inverted or not',
    (_, row, min, max) => {
      expect(ccValue(row, range(min, max), 0)).toBe(min);
      expect(ccValue(row, range(min, max), 127)).toBe(max);
      expect(ccValue(row, range(min, max, true), 0)).toBe(max);
      expect(ccValue(row, range(min, max, true), 127)).toBe(min);
      expect(ccPosition(row, range(min, max), min)).toBe(0);
      expect(ccPosition(row, range(min, max, true), min)).toBe(127);
    },
  );

  it('clamps a value outside the range to its end: a 1 kHz cutoff under 2–6 kHz', () => {
    expect(ccPosition(CUTOFF, range(2000, 6000), 1000)).toBe(0);
    expect(ccPosition(CUTOFF, range(2000, 6000, true), 1000)).toBe(127);
    expect(ccPosition(CUTOFF, range(2000, 6000), 18000)).toBe(127);
  });

  it('clamps a range wider than the row to the row', () => {
    expect(ccValue(LEVEL, range(-1, 2), 0)).toBe(0);
    expect(ccValue(LEVEL, range(-1, 2), 127)).toBe(1);
    expect(ccValue(LEVEL, range(-1, 2), 63.5)).toBeCloseTo(0.5, 12);
  });

  it('sets one value for every CC when min equals max, with no pickup position', () => {
    for (const cc of [0, 64, 127]) expect(ccValue(CUTOFF, range(3000, 3000), cc)).toBe(3000);
    expect(ccPosition(CUTOFF, range(3000, 3000), 3000)).toBeNull();
    expect(ccPosition(LEVEL, range(0.4, 0.4, true), 0.9)).toBeNull();
  });

  it('defaults a new mapping to the target’s full range', () => {
    expect(ccDefaultRange(STRIP_LEVEL)).toEqual({ min: STRIP_LEVEL.min, max: STRIP_LEVEL.max });
  });
});

describe('isCcMappableTarget', () => {
  it('takes the strip, a voice row, a macro and an insert’s continuous field', () => {
    for (const id of [
      'strip.level',
      'strip.send.b',
      'voice.filter.cutoff',
      'voice.macros.1.value',
      'insert.fx1.cutoff',
      'insert.fx1.slot.mix',
    ]) {
      expect(isCcMappableTarget(id), id).toBe(true);
    }
  });

  it('refuses a switch row, an enum insert field, a seq. row and an unknown id', () => {
    for (const id of [
      'insert.fx1.enabled',
      'insert.fx1.freeze',
      'insert.fx1.slot.enabled',
      'insert.fx1.mode',
      SEQ_AUTOMATION_ROWS[0]!.target,
      'voice.nope',
      'strip.mute',
    ]) {
      expect(isCcMappableTarget(id), id).toBe(false);
    }
  });
});
