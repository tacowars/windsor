/**
 * The Euclid rows read at a hit (windsor#355): absent is a plain hit, each
 * lane reads the trigger's local step mod its own length, the ratchet row is
 * keyed to the figure's step, and a step's span follows the swing.
 */
import { describe, expect, it } from 'vitest';

import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  EUCLID_LANE_STEPS_MAX,
  EUCLID_RATCHET_MAX,
} from '../audioConstants';
import { STEP_MOD_PARAMS } from '../worklet/fm/stepModTables';
import { assertEuclidRows, euclidHitRead, laneStep, rollSpanSeconds } from './euclidLanes';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  EuclideanSequencer,
  type OnsetEvent,
} from './euclideanSequencer';
import { TICKS_PER_BAR, TickTransport } from './scheduler';
import { swingTicks } from './swing';
import { STRAIGHT_SWING } from './swingTables';

describe('euclidHitRead', () => {
  it('is a plain hit with no rows', () => {
    expect(euclidHitRead({}, 3, 99)).toEqual({
      ratchet: 1,
      accent: undefined,
      semitones: 0,
      stepMod: undefined,
    });
  });

  it('reads each lane at the local step mod its own length', () => {
    const rows = {
      accentLane: [false, true, false],
      pitchLane: [0, 2, 4, 5, 7],
      modLanes: [{ param: 'filter.cutoff' as const, values: [0, 0.5] }],
    };
    for (let local = 0; local < 30; local++) {
      const read = euclidHitRead(rows, 0, local);
      expect(read.accent !== undefined).toBe(local % 3 === 1);
      expect(read.semitones).toBe(rows.pitchLane[local % 5]);
      expect(read.stepMod?.[STEP_MOD_PARAMS.indexOf('filter.cutoff')]).toBe(
        local % 2 === 1 ? 0.5 : undefined,
      );
    }
  });

  it('takes the accent amounts, or the grid’s defaults', () => {
    expect(euclidHitRead({ accentLane: [true] }, 0, 0).accent).toEqual({
      velocity: ACCENT_VELOCITY_DEFAULT,
      mod: ACCENT_MOD_DEFAULT,
    });
    const own = { accentLane: [true], accentVelocity: 0.1, accentMod: 0.3 };
    expect(euclidHitRead(own, 0, 0).accent).toEqual({ velocity: 0.1, mod: 0.3 });
  });

  it('keys the ratchet to the figure’s step, and a step past the row reads 1', () => {
    const rows = { ratchets: [1, 2, 3, 4] };
    expect(euclidHitRead(rows, 2, 40).ratchet).toBe(3);
    expect(euclidHitRead(rows, 3, 0).ratchet).toBe(4);
    expect(euclidHitRead(rows, 9, 0).ratchet).toBe(1);
  });
});

describe('laneStep', () => {
  it('wraps any local step into the lane, negative included', () => {
    expect([0, 6, 7, 15, -1].map((s) => laneStep(s, 7))).toEqual([0, 6, 0, 1, 6]);
  });
});

describe('rollSpanSeconds', () => {
  it('is its ticks straight', () => {
    const clock = { tick: 18, ticks: 6, secondsPerTick: 0.01, swing: STRAIGHT_SWING };
    expect(rollSpanSeconds(clock)).toBeCloseTo(0.06, 15);
  });

  it('follows the swing: the on-beat stretches, the off-beat shrinks, the pair sums', () => {
    const swing = { amount: 66, grid: 16 as const };
    const at = (tick: number): number =>
      rollSpanSeconds({ tick, ticks: 6, secondsPerTick: 0.01, swing });
    expect(at(0)).toBeCloseTo((swingTicks(6, swing) - swingTicks(0, swing)) * 0.01, 15);
    expect(at(0)).toBeGreaterThan(0.06);
    expect(at(6)).toBeLessThan(0.06);
    expect(at(0) + at(6)).toBeCloseTo(0.12, 12);
    expect(at(90)).toBeCloseTo(at(6), 15);
  });
});

describe('assertEuclidRows', () => {
  it('accepts what a normalised document carries', () => {
    const rows = {
      ratchets: [1, EUCLID_RATCHET_MAX],
      accentVelocity: 0,
      accentMod: 1,
      accentLane: [true],
      pitchLane: [-24, 24],
      modLanes: [{ param: 'filter.cutoff' as const, values: [-1, 1] }],
    };
    expect(() => assertEuclidRows(rows)).not.toThrow();
    expect(() => assertEuclidRows({})).not.toThrow();
  });

  it.each([
    [{ ratchets: [0] }, /ratchets/],
    [{ ratchets: [1.5] }, /ratchets/],
    [{ ratchets: [EUCLID_RATCHET_MAX + 1] }, /ratchets/],
    [{ accentVelocity: 1.2 }, /accent/],
    [{ accentLane: [] }, /accentLane/],
    [{ accentLane: Array(EUCLID_LANE_STEPS_MAX + 1).fill(true) }, /accentLane/],
    [{ pitchLane: [25] }, /pitchLane/],
    [{ pitchLane: [0.5] }, /pitchLane/],
    [{ modLanes: [{ param: 'filter.cutoff' as const, values: [] }] }, /modLanes\[0\]/],
    [{ modLanes: [{ param: 'filter.cutoff' as const, values: [2] }] }, /values/],
  ])('refuses %j', (rows, message) => {
    expect(() => assertEuclidRows(rows as never)).toThrow(message);
  });
});

describe('the onset’s clocks', () => {
  it('carries the local step the lanes read and the tick’s length', () => {
    const { divisor } = DEFAULT_EUCLIDEAN_CONFIG;
    const seq = new EuclideanSequencer({
      ...DEFAULT_EUCLIDEAN_CONFIG,
      pattern: Array(16).fill(true),
    });
    const transport = new TickTransport(120);
    const onsets: OnsetEvent[] = [];
    transport.subscribe(divisor, (event) => {
      const onset = seq.handleTick(event);
      if (onset) onsets.push(onset);
    });
    for (let i = 0; i < 2 * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
    expect(onsets).toHaveLength(32);
    for (const onset of onsets) {
      expect(onset.localStep).toBe(onset.tick / divisor);
      expect(onset.step).toBe(onset.localStep % 16);
      expect(onset.secondsPerTick).toBeCloseTo(60 / 120 / 24, 15);
    }
  });
});
