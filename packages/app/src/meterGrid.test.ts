import { describe, expect, it } from 'vitest';

import type { Meter } from '@windsor/engine';
import { DIVISORS, METERS, meterBeats, ticksPerBar } from '@windsor/engine';
import { beatAt, beatStarts, stepGrouper } from './meterGrid';

/** A strip's groups as the issue writes them: `·` a beat gap, `|` a bar gap. */
function drawn(count: number, divisor: number, meter?: Meter): string {
  const groupAt = stepGrouper(divisor, meter);
  const sizes: { size: number; gap: string }[] = [];
  for (let i = 0; i < count; i++) {
    const group = groupAt(i);
    const last = sizes.at(-1);
    if (i === 0 || group !== '') sizes.push({ size: 1, gap: group === 'bar' ? '|' : '·' });
    else if (last) last.size++;
  }
  return sizes.map((g, i) => (i === 0 ? `${g.size}` : `${g.gap} ${g.size}`)).join(' ');
}

describe('beatStarts and beatAt', () => {
  it("place each counted beat from the engine's table", () => {
    expect(beatStarts(meterBeats('7/8'))).toEqual([0, 24, 48]);
    expect(beatStarts(meterBeats('6/8'))).toEqual([0, 36]);
    expect(beatAt(83, meterBeats('7/8'))).toEqual({ beat: 2, start: 48 });
    expect(beatAt(35, meterBeats('6/8'))).toEqual({ beat: 0, start: 0 });
  });
});

describe('stepGrouper (windsor#431 decision 5)', () => {
  const { sixteenth, eighth, quarter, whole } = DIVISORS;

  it('groups a step strip by the counted beats', () => {
    expect(drawn(14, sixteenth, '7/8')).toBe('4 · 4 · 6');
    expect(drawn(6, eighth, '6/8')).toBe('3 · 3');
    expect(drawn(16, sixteenth, '4/4')).toBe('4 · 4 · 4 · 4');
    expect(drawn(16, sixteenth)).toBe('4 · 4 · 4 · 4');
    expect(drawn(8, eighth, '4/4')).toBe('2 · 2 · 2 · 2');
    expect(drawn(32, DIVISORS.thirtySecond, '4/4')).toBe('8 · 8 · 8 · 8');
  });

  it("keeps the bar's beats after the first bar, with a bar gap at each bar line", () => {
    expect(drawn(16, sixteenth, '7/8')).toBe('4 · 4 · 6 | 2');
    expect(drawn(8, sixteenth, '6/8')).toBe('6 · 2');
  });

  it('gaps only at the bar when a beat holds fewer than two steps', () => {
    expect(drawn(8, quarter, '4/4')).toBe('4 | 4');
    expect(drawn(7, quarter, '7/8')).toBe('4 | 3');
    // 1/2T never lands on 7/8's bar line: the gap goes before the first step past it.
    expect(drawn(6, 32, '7/8')).toBe('3 | 3');
  });

  it('groups by four with the beat gap when a step is a bar or longer', () => {
    const groupAt = stepGrouper(whole, '3/4');
    expect(drawn(9, whole, '3/4')).toBe('4 · 4 · 1');
    expect([1, 2, 3, 4].map(groupAt)).toEqual(['', '', '', 'beat']);
  });

  it('draws one bar gap per bar line crossed, in every meter at every step', () => {
    const steps = [96, 48, 32, 24, 16, 12, 8, 6, 4, 3];
    for (const meter of METERS) {
      const bar = ticksPerBar(meter);
      for (const divisor of steps.filter((d) => d < bar)) {
        const count = Math.ceil((2 * bar) / divisor) + 1;
        const groupAt = stepGrouper(divisor, meter);
        const bars = Array.from({ length: count }, (_, i) => groupAt(i)).filter((g) => g === 'bar');
        const crossed = Math.floor(((count - 1) * divisor) / bar);
        expect(bars.length, `${meter} at ${divisor}`).toBe(crossed);
      }
    }
  });
});
