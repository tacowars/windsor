/**
 * `Scheduler.seek` (windsor#102, the Song view's playhead drag): a stopped or
 * paused transport moves to the tick, reads it as the playhead and issues it
 * first on the next start; a running one refuses. With a loop on, a seek
 * before the loop plays on into it and wraps there, one inside it loops from
 * where it landed, and a later loop edit leaves the sought tick alone.
 */
import { describe, expect, it } from 'vitest';

import { Scheduler, TICKS_PER_BAR, type TickLoop } from './scheduler';

const BAR = TICKS_PER_BAR;
/** Bars 9–12 of a 16-bar song, as bar indices 8..11. */
const LOOP: TickLoop = { start: 8 * BAR, end: 12 * BAR, songTicks: 16 * BAR };

function rig(loop: TickLoop | null = null) {
  const clock = { currentTime: 0 };
  const scheduler = new Scheduler(clock, { lookAhead: 0.1 });
  scheduler.loop = loop;
  const bars: number[] = [];
  const ticks: number[] = [];
  scheduler.subscribe(1, (e) => ticks.push(e.tick));
  scheduler.subscribe(BAR, (e) => bars.push((e.tick % LOOP.songTicks) / BAR));
  /** Run the clock for `n` ticks' worth of time. */
  const play = (n: number): void => {
    for (let i = 0; i < n; i++) {
      clock.currentTime += scheduler.transport.secondsPerTick;
      scheduler.update();
    }
  };
  return { clock, scheduler, bars, ticks, play };
}

describe('Scheduler.seek while halted', () => {
  it('moves a stopped transport: the playhead reads the tick and start issues it first', () => {
    const { clock, scheduler, ticks, play } = rig();
    expect(scheduler.seek(3 * BAR)).toBe(true);
    expect(scheduler.transport.currentTick).toBe(3 * BAR);
    expect(scheduler.audibleTick(clock.currentTime)).toBe(3 * BAR);
    scheduler.start(scheduler.transport.currentTick);
    expect(scheduler.audibleTick(clock.currentTime)).toBe(3 * BAR);
    play(4);
    expect(ticks[0]).toBe(3 * BAR);
  });

  it('moves a paused transport, and the resume starts from the new tick, not the paused one', () => {
    const { clock, scheduler, ticks, play } = rig();
    scheduler.start(0);
    play(2 * BAR);
    scheduler.stop();
    const paused = scheduler.transport.currentTick;
    expect(paused).toBeGreaterThan(0);
    expect(scheduler.seek(5 * BAR)).toBe(true);
    expect(scheduler.audibleTick(clock.currentTime)).toBe(5 * BAR);
    ticks.length = 0;
    scheduler.start(scheduler.transport.currentTick);
    play(4);
    expect(ticks[0]).toBe(5 * BAR);
    expect(ticks).not.toContain(paused);
  });

  it('keeps the seconds a straight run would have at that tick', () => {
    const { scheduler } = rig();
    scheduler.seek(2 * BAR);
    expect(scheduler.transport.transportSeconds).toBeCloseTo(
      2 * BAR * scheduler.transport.secondsPerTick,
      12,
    );
  });
});

describe('Scheduler.seek refusals', () => {
  it('refuses while running and changes nothing', () => {
    const { clock, scheduler, play } = rig();
    scheduler.start(0);
    play(BAR);
    const before = scheduler.transport.currentTick;
    const audible = scheduler.audibleTick(clock.currentTime);
    expect(scheduler.seek(8 * BAR)).toBe(false);
    expect(scheduler.transport.currentTick).toBe(before);
    expect(scheduler.audibleTick(clock.currentTime)).toBe(audible);
    expect(scheduler.isRunning).toBe(true);
  });

  it('refuses a negative or fractional tick', () => {
    const { scheduler } = rig();
    scheduler.seek(BAR);
    expect(scheduler.seek(-BAR)).toBe(false);
    expect(scheduler.seek(BAR + 0.5)).toBe(false);
    expect(scheduler.seek(Number.NaN)).toBe(false);
    expect(scheduler.transport.currentTick).toBe(BAR);
  });
});

describe('Scheduler.seek with a loop', () => {
  it('plays from a bar before the loop into it, then loops (bars 3–8, then 9–12 round)', () => {
    const { scheduler, bars, play } = rig(LOOP);
    expect(scheduler.transport.currentTick).toBe(LOOP.start);
    expect(scheduler.seek(2 * BAR)).toBe(true);
    scheduler.start(scheduler.transport.currentTick);
    play(15 * BAR);
    expect(bars.slice(0, 15)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 8, 9, 10, 11, 8]);
  });

  it('plays from a bar inside the loop and loops from its start', () => {
    const { scheduler, bars, play } = rig(LOOP);
    scheduler.seek(10 * BAR);
    scheduler.start(scheduler.transport.currentTick);
    play(7 * BAR);
    expect(bars.slice(0, 7)).toEqual([10, 11, 8, 9, 10, 11, 8]);
  });

  it('leaves a sought tick where it is when the loop changes, until ■ rewinds', () => {
    const { scheduler } = rig(LOOP);
    scheduler.seek(2 * BAR);
    scheduler.loop = null;
    expect(scheduler.transport.currentTick).toBe(2 * BAR);
    scheduler.loop = LOOP;
    expect(scheduler.transport.currentTick).toBe(2 * BAR);
    scheduler.reset();
    expect(scheduler.transport.currentTick).toBe(LOOP.start);
    scheduler.loop = null;
    expect(scheduler.transport.currentTick).toBe(0);
  });
});
