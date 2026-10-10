/**
 * Rec's looks and place (windsor#663, the mockup's five looks), and the
 * playhead reading that judges a loop's jump between two readings.
 */
import { describe, expect, it } from 'vitest';

import { TapClock, nextLoopEnd } from './rollRecClock';
import { type RecPlace, recLook } from './rollRecState';

const IN: RecPlace = { roll: true, region: 0, full: false };
const GAP: RecPlace = { roll: true, region: null, full: false };
const FULL: RecPlace = { roll: true, region: 0, full: true };
const NOT_ROLL: RecPlace = { roll: false, region: null, full: false };

describe('recLook', () => {
  it('draws each of the mockup’s looks at its moment', () => {
    const look = (armed: boolean, running: boolean, place: RecPlace): string =>
      recLook({ armed, running, place });
    expect(look(false, true, GAP)).toBe('no-region');
    expect(look(false, false, NOT_ROLL)).toBe('no-region');
    expect(look(false, true, IN)).toBe('off');
    expect(look(true, false, GAP)).toBe('armed');
    expect(look(true, true, GAP)).toBe('paused');
    expect(look(true, true, IN)).toBe('recording');
    expect(look(true, true, FULL)).toBe('full');
  });
});

describe('TapClock', () => {
  const LOOP = { start: 96, end: 192, songTicks: 768 };

  it('finds the loop’s next end in transport ticks, on any pass of the song', () => {
    expect(nextLoopEnd(98, LOOP)).toBe(192);
    expect(nextLoopEnd(800, LOOP)).toBe(960);
  });

  it('passes the loop’s end when the clock says the loop wrapped since the last reading', () => {
    const clock = new TapClock();
    expect(clock.observe({ tick: 98, time: 0.98 }, LOOP, 0.01)).toEqual([98]);
    expect(clock.observe({ tick: 100, time: 1.96 }, LOOP, 0.01)).toEqual([192, 100]);
  });

  it('reads a step forward as a step, and needs no loop', () => {
    const clock = new TapClock();
    clock.observe({ tick: 98, time: 0.98 }, LOOP, 0.01);
    expect(clock.observe({ tick: 103, time: 1.04 }, LOOP, 0.01)).toEqual([103]);
    expect(clock.observe({ tick: 200, time: 9 }, null, 0.01)).toEqual([200]);
  });
});
