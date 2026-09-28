/**
 * The loop in the one clock (windsor#15): the tick after the loop's last is
 * its first, a whole-song loop jumps nothing, the counter still folds past
 * the song's end when the loop is set late, and the scheduler's rest
 * position follows the loop.
 */
import { describe, expect, it } from 'vitest';

import {
  Scheduler,
  TICKS_PER_BAR,
  TickTransport,
  followingTick,
  isLoopJump,
  type TickLoop,
} from './scheduler';

const BAR = TICKS_PER_BAR;
const LOOP: TickLoop = { start: 4 * BAR, end: 8 * BAR, songTicks: 12 * BAR };

describe('followingTick', () => {
  it('counts on without a loop, and wraps the loop end to its start', () => {
    expect(followingTick(10, null)).toBe(11);
    expect(followingTick(LOOP.end - 2, LOOP)).toBe(LOOP.end - 1);
    expect(followingTick(LOOP.end - 1, LOOP)).toBe(LOOP.start);
  });

  it('wraps on the loop end of a later song iteration too', () => {
    const later = 2 * LOOP.songTicks + LOOP.end - 1;
    expect(followingTick(later, LOOP)).toBe(later + 1 - (LOOP.end - LOOP.start));
  });

  it('wraps a loop ending on the song end back to its start', () => {
    const tail: TickLoop = { start: 8 * BAR, end: 12 * BAR, songTicks: 12 * BAR };
    expect(followingTick(12 * BAR - 1, tail)).toBe(8 * BAR);
  });

  it('jumps nothing for a whole-song loop or an empty one', () => {
    const whole: TickLoop = { start: 0, end: 12 * BAR, songTicks: 12 * BAR };
    expect(followingTick(12 * BAR - 1, whole)).toBe(12 * BAR);
    const empty: TickLoop = { start: 4 * BAR, end: 4 * BAR, songTicks: 12 * BAR };
    expect(followingTick(4 * BAR - 1, empty)).toBe(4 * BAR);
  });
});

describe('isLoopJump', () => {
  it('is the jump back only, never a step or a restart elsewhere', () => {
    expect(isLoopJump(LOOP.end - 1, LOOP.start, LOOP)).toBe(true);
    expect(isLoopJump(LOOP.end - 2, LOOP.end - 1, LOOP)).toBe(false);
    expect(isLoopJump(LOOP.end - 1, 0, LOOP)).toBe(false);
    expect(isLoopJump(LOOP.end - 1, LOOP.start, null)).toBe(false);
  });
});

describe('TickTransport with a loop', () => {
  it('plays on past a loop set late, folds at the song end, then wraps', () => {
    const transport = new TickTransport(120);
    transport.reset(10 * BAR);
    transport.loop = LOOP;
    const seen: number[] = [];
    transport.subscribe(BAR, (e) => seen.push(e.tick / BAR));
    for (let i = 0; i < 12 * BAR; i++) transport.advance(0);
    // Bars 11, 12, then the song's own wrap (13 ≡ 1), on to the loop, and round it.
    expect(seen).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 16, 17]);
  });

  it('keeps its seconds running across the jump', () => {
    const transport = new TickTransport(120);
    transport.loop = LOOP;
    transport.reset(LOOP.end - 1);
    const before = transport.transportSeconds;
    transport.advance(0);
    expect(transport.currentTick).toBe(LOOP.start);
    expect(transport.transportSeconds - before).toBeCloseTo(transport.secondsPerTick, 12);
  });
});

describe('Scheduler rest position', () => {
  it('rewinds to the loop start at rest, back to 0 when the loop goes, and ■ follows it', () => {
    const scheduler = new Scheduler({ currentTime: 0 });
    scheduler.loop = LOOP;
    expect(scheduler.transport.currentTick).toBe(LOOP.start);
    expect(scheduler.audibleTick(0)).toBe(LOOP.start);
    scheduler.loop = null;
    expect(scheduler.transport.currentTick).toBe(0);
    scheduler.loop = LOOP;
    scheduler.start(scheduler.transport.currentTick);
    scheduler.stop();
    scheduler.loop = null;
    expect(scheduler.transport.currentTick).toBe(LOOP.start);
    scheduler.loop = LOOP;
    scheduler.reset();
    expect(scheduler.transport.currentTick).toBe(LOOP.start);
  });

  it('reads the playhead across the wrap from the stamps it issued', () => {
    const clock = { currentTime: 0 };
    const scheduler = new Scheduler(clock, { lookAhead: 0.1 });
    scheduler.loop = LOOP;
    scheduler.reset(LOOP.end - 4);
    scheduler.start(LOOP.end - 4);
    const played: number[] = [];
    for (let i = 0; i < 40; i++) {
      clock.currentTime += scheduler.transport.secondsPerTick / 2;
      scheduler.update();
      played.push(scheduler.audibleTick(clock.currentTime));
    }
    const wrapped = played.indexOf(LOOP.start);
    expect(wrapped).toBeGreaterThan(0);
    expect(played[wrapped - 1]).toBe(LOOP.end - 1);
    expect(played.slice(wrapped).every((tick) => tick >= LOOP.start && tick < LOOP.end)).toBe(true);
  });
});
