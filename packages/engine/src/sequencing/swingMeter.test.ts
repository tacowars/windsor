/**
 * Swing in a meter (windsor#428): pairs restart at every counted beat, a
 * remainder shorter than a pair plays straight, and 4/4 is the pre-meter warp
 * bit for bit.
 */
import { describe, expect, it } from 'vitest';

import { meterBeats } from './meter';
import { METERS, type Meter } from './meterTables';
import { swingSlope, swingTicks, unswingTicks } from './swing';
import {
  SWING_AMOUNT_MAX,
  SWING_AMOUNT_MIN,
  SWING_GRIDS,
  SWING_TABLE,
  type Swing,
} from './swingTables';

/** Every amount the song allows, in half-percent steps, on both grids. */
const SWEEP: Swing[] = SWING_GRIDS.flatMap((grid) =>
  Array.from({ length: (SWING_AMOUNT_MAX - SWING_AMOUNT_MIN) * 2 + 1 }, (_, i) => ({
    amount: SWING_AMOUNT_MIN + i / 2,
    grid,
  })),
);

/** The warp as it was before the meter (windsor#14): pairs counted from tick 0. */
const before = {
  slope(tick: number, swing: Swing): number {
    if (swing.amount === SWING_TABLE.straight) return 1;
    const pair = SWING_TABLE.pairTicks[swing.grid];
    const phase = ((tick % pair) + pair) % pair;
    const a = swing.amount / SWING_TABLE.percent;
    return phase < pair / 2 ? 2 * a : 2 * (1 - a);
  },
  swing(tick: number, swing: Swing): number {
    if (swing.amount === SWING_TABLE.straight) return tick;
    const pair = SWING_TABLE.pairTicks[swing.grid];
    const start = Math.floor(tick / pair) * pair;
    const phase = tick - start;
    const half = pair / 2;
    const a = swing.amount / SWING_TABLE.percent;
    const warped = phase < half ? phase * 2 * a : a * pair + (phase - half) * 2 * (1 - a);
    return start + warped;
  },
  unswing(warped: number, swing: Swing): number {
    if (swing.amount === SWING_TABLE.straight) return warped;
    const pair = SWING_TABLE.pairTicks[swing.grid];
    const start = Math.floor(warped / pair) * pair;
    const phase = warped - start;
    const half = pair / 2;
    const a = swing.amount / SWING_TABLE.percent;
    const offBeatAt = a * pair;
    const tick = phase < offBeatAt ? phase / (2 * a) : half + (phase - offBeatAt) / (2 * (1 - a));
    return start + tick;
  },
};

const at = (meter: Meter) => {
  const beats = meterBeats(meter);
  return {
    swing: (tick: number, swing: Swing) => swingTicks(tick, swing, SWING_TABLE, beats),
    unswing: (tick: number, swing: Swing) => unswingTicks(tick, swing, SWING_TABLE, beats),
    slope: (tick: number, swing: Swing) => swingSlope(tick, swing, SWING_TABLE, beats),
  };
};

describe('swing in 4/4 (windsor#428)', () => {
  it('is the pre-meter warp bit for bit, both grids, the full sweep', () => {
    const fourFour = at('4/4');
    const differ: string[] = [];
    const check = (what: string, got: number, want: number): void => {
      if (!Object.is(got, want)) differ.push(`${what}: ${got} != ${want}`);
    };
    for (const swing of SWEEP) {
      for (let t = -100; t < 1200; t += 0.125) {
        check(`swing ${t}`, swingTicks(t, swing), before.swing(t, swing));
        check(`4/4 swing ${t}`, fourFour.swing(t, swing), before.swing(t, swing));
        check(`unswing ${t}`, unswingTicks(t, swing), before.unswing(t, swing));
        check(`4/4 unswing ${t}`, fourFour.unswing(t, swing), before.unswing(t, swing));
        if (Number.isInteger(t)) {
          check(`slope ${t}`, swingSlope(t, swing), before.slope(t, swing));
          check(`4/4 slope ${t}`, fourFour.slope(t, swing), before.slope(t, swing));
        }
      }
    }
    expect(differ.slice(0, 5)).toEqual([]);
  });
});

describe('swing in 7/8 (2+2+3)', () => {
  const sevenEight = at('7/8');
  const hard: Swing = { amount: 75, grid: 8 };

  it('swings beats 1 and 2 and beat 3 first pair, and plays beat 3 third 8th straight', () => {
    for (let bar = 0; bar < 8; bar++) {
      const start = bar * 84;
      const where = (offset: number): number => sevenEight.swing(start + offset, hard) - start;
      // Every downbeat on its straight tick.
      for (const downbeat of [0, 24, 48]) expect(where(downbeat)).toBe(downbeat);
      // The off-beat 8ths of beats 1 and 2 at 3/4 of their quarter.
      expect(where(12)).toBe(18);
      expect(where(36)).toBe(42);
      // Beat 3: its second 8th at 3/4 of its pair, its third straight.
      expect(where(60)).toBe(66);
      expect(where(72)).toBe(72);
      expect(where(78)).toBe(78);
      // The next bar starts where it would straight.
      expect(where(84)).toBe(84);
    }
  });

  it('times the straight remainder at slope 1, every bar summing to the bar', () => {
    for (let t = 72; t < 84; t++) expect(sevenEight.slope(t, hard)).toBe(1);
    let sum = 0;
    for (let t = 0; t < 84; t++) sum += sevenEight.slope(t, hard);
    expect(sum).toBe(84);
  });
});

describe('swing in compound meters', () => {
  it('swings every 16th pair in 6/8 and 12/8, none crossing a beat', () => {
    const hard: Swing = { amount: 75, grid: 16 };
    for (const meter of ['6/8', '12/8'] as const) {
      const warp = at(meter);
      const bar = meter === '6/8' ? 72 : 144;
      for (let t = 0; t < 4 * bar; t += 12) {
        // Every pair starts on its straight tick, its off-beat at 3/4.
        expect(warp.swing(t, hard)).toBe(t);
        expect(warp.swing(t + 6, hard)).toBe(t + 9);
      }
      // Each dotted-quarter beat is three whole pairs.
      let sum = 0;
      for (let t = 0; t < 36; t++) sum += warp.slope(t, hard);
      expect(sum).toBe(36);
    }
  });

  it('swings each 6/8 beat as one 8th pair and one straight 8th', () => {
    const warp = at('6/8');
    const hard: Swing = { amount: 75, grid: 8 };
    for (const beat of [0, 36, 72, 108]) {
      expect(warp.swing(beat, hard)).toBe(beat);
      expect(warp.swing(beat + 12, hard)).toBe(beat + 18);
      expect(warp.swing(beat + 24, hard)).toBe(beat + 24);
      expect(warp.swing(beat + 30, hard)).toBe(beat + 30);
    }
  });
});

describe('swing in every meter', () => {
  it('is monotonic and inverts exactly, both grids, every amount', () => {
    const failures: string[] = [];
    for (const meter of METERS) {
      const warp = at(meter);
      for (const swing of SWEEP) {
        let last = -Infinity;
        for (let t = -50; t < 400; t += 0.25) {
          const w = warp.swing(t, swing);
          if (!(w > last)) failures.push(`${meter} ${swing.amount}/${swing.grid}: ${t} not after`);
          last = w;
          const back = warp.unswing(w, swing);
          if (Math.abs(back - t) > 1e-9) failures.push(`${meter}: unswing(swing(${t})) = ${back}`);
          if (Number.isInteger(t) && !(warp.slope(t, swing) > 0))
            failures.push(`${meter} slope ${t}`);
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});
