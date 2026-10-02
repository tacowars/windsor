import { describe, expect, it } from 'vitest';

import { barTicks, isMeter, meterBeats, songTicks, ticksPerBar } from './meter';
import { FOUR_FOUR, METERS, METER_TABLE, type Meter } from './meterTables';
import { DIVISORS, PPQ, TICKS_PER_BAR } from './scheduler';

describe('the meter table (windsor#428)', () => {
  it('ships the six meters, 4/4 the default', () => {
    expect(METERS).toEqual(['3/4', '4/4', '5/4', '6/8', '7/8', '12/8']);
    expect(Object.keys(METER_TABLE)).toEqual([...METERS]);
    expect(FOUR_FOUR).toBe('4/4');
  });

  it('counts quarter beats as PPQ and dotted-quarter beats as three 8ths', () => {
    expect(METER_TABLE['4/4']).toEqual([PPQ, PPQ, PPQ, PPQ]);
    expect(METER_TABLE['6/8']).toEqual([3 * DIVISORS.eighth, 3 * DIVISORS.eighth]);
    // 7/8 grouped 2+2+3.
    expect(METER_TABLE['7/8']).toEqual([PPQ, PPQ, 3 * DIVISORS.eighth]);
  });

  it('makes every bar its time signature: numerator × the denominator note', () => {
    for (const meter of METERS) {
      const [count, note] = meter.split('/').map(Number) as [number, number];
      expect(ticksPerBar(meter)).toBe((count * DIVISORS.whole) / note);
    }
  });
});

describe('ticksPerBar and songTicks', () => {
  it('give 72, 96, 120, 72, 84, 144 per bar', () => {
    const bars: Record<Meter, number> = {
      '3/4': 72,
      '4/4': 96,
      '5/4': 120,
      '6/8': 72,
      '7/8': 84,
      '12/8': 144,
    };
    for (const meter of METERS) {
      expect(ticksPerBar(meter)).toBe(bars[meter]);
      expect(barTicks(meterBeats(meter))).toBe(bars[meter]);
      expect(songTicks(1, meter)).toBe(bars[meter]);
      expect(songTicks(7, meter)).toBe(7 * bars[meter]);
    }
  });

  it("is today's 4/4 arithmetic with no meter", () => {
    expect(ticksPerBar()).toBe(TICKS_PER_BAR);
    for (let bars = 1; bars <= 256; bars++) expect(songTicks(bars)).toBe(bars * 96);
  });

  it('reads a meter the table does not name as 4/4', () => {
    const unknown = '9/8' as Meter;
    expect(isMeter(unknown)).toBe(false);
    expect(isMeter('7/8')).toBe(true);
    expect(isMeter('toString')).toBe(false);
    expect(meterBeats(unknown)).toBe(METER_TABLE['4/4']);
    expect(songTicks(2, unknown)).toBe(192);
  });

  it('reads an injected table', () => {
    const table = { ...METER_TABLE, '4/4': [48, 48] };
    expect(ticksPerBar(FOUR_FOUR, table)).toBe(96);
    expect(meterBeats(FOUR_FOUR, table)).toEqual([48, 48]);
  });
});
