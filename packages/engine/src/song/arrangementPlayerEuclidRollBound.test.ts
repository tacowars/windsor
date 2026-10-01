/**
 * A ratchet's roll stays inside what the transport plays next (windsor#355):
 * its hits are queued at once, so the span they divide stops at the end of
 * the region the hit came from, or at the loop's jump, whichever is first.
 * The roll keeps its count and its hold rule, `min(hold, spacing)`.
 */
import { describe, expect, it } from 'vitest';

import { ALL_ON, SECONDS_PER_TICK, kickSong, type KickSong } from '../__fixtures__/euclidSongs';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';

const HOLD = 0.2;
/** A 16-step figure lit everywhere, rolled ×4 on step `at` only. */
const rolledOn = (at: number): number[] => Array.from({ length: 16 }, (_, i) => (i === at ? 4 : 1));

/** The kick's triggers over `bars`, as [start tick, held ticks]. */
function play(song: KickSong, bars = 1): Array<[number, number]> {
  const { parts, run } = rig(kickSong(song));
  run(bars);
  return parts.kick.calls
    .filter((c: Call) => c.kind === 'trigger')
    .map((c) => [(c.time ?? 0) / SECONDS_PER_TICK, (c.duration ?? 0) / SECONDS_PER_TICK]);
}

/** `expected` [start, held] pairs, matched to the recorded ones within float noise. */
function expectHits(actual: Array<[number, number]>, expected: Array<[number, number]>): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([start, held], i) => {
    expect(start, `hit ${i} start`).toBeCloseTo(expected[i]![0], 9);
    expect(held, `hit ${i} hold`).toBeCloseTo(expected[i]![1], 9);
  });
}

const FULL = HOLD / SECONDS_PER_TICK;
const hit = (start: number, held = FULL): [number, number] => [start, held];

describe('a roll stops at its region’s end and the loop’s jump (windsor#355)', () => {
  it('a last-step roll before a gap ends with its region', () => {
    // Steps at 0, 6, 12 and 18; the region ends at 20, so step 3's roll has 2 ticks.
    const sequencer = { pattern: ALL_ON, divisor: 6, ratchets: rolledOn(3), hold: HOLD };
    const hits = play({ sequencer, part: { regions: [{ start: 0, duration: 20 }] } });
    expectHits(hits, [hit(0), hit(6), hit(12), ...[18, 18.5, 19, 19.5].map((t) => hit(t, 0.5))]);
  });

  it('a last-step roll right before another region ends where that region starts', () => {
    const regions = [
      { start: 0, duration: 20 },
      { start: 20, duration: 76 },
    ];
    const sequencer = { pattern: ALL_ON, divisor: 6, ratchets: rolledOn(3), hold: HOLD };
    const hits = play({ sequencer, part: { regions } }).filter(([start]) => start < 27);
    // The second region re-enters on 20: its own step 0 there, step 1 on 26.
    const roll = [18, 18.5, 19, 19.5].map((t) => hit(t, 0.5));
    expectHits(hits, [hit(0), hit(6), hit(12), ...roll, hit(20), hit(26)]);
  });

  it('a roll straddling the loop’s end stops at the jump', () => {
    // Steps every 16 ticks; the loop jumps from 24 back to 0, so the roll on 16 has 8 ticks.
    const sequencer = { pattern: ALL_ON, divisor: 16, ratchets: rolledOn(1), hold: HOLD };
    const transport = { loop: { start: 0, end: 24, on: true } };
    const hits = play({ sequencer, transport }).filter(([start]) => start < 48);
    const roll = (at: number): Array<[number, number]> => [0, 2, 4, 6].map((t) => hit(at + t, 2));
    // Each pass replays from step 0: on 0 and 16, then on 24 and 40 in time.
    expectHits(hits, [hit(0), ...roll(16), hit(24), ...roll(40)]);
  });

  it('a one-tick region rolls within its one tick', () => {
    const sequencer = { pattern: ALL_ON, divisor: 6, ratchets: rolledOn(0), hold: HOLD };
    const hits = play({ sequencer, part: { regions: [{ start: 0, duration: 1 }] } });
    expectHits(
      hits,
      [0, 0.25, 0.5, 0.75].map((t) => hit(t, 0.25)),
    );
  });

  it('a roll with room to spare keeps the whole step', () => {
    const sequencer = { pattern: ALL_ON, divisor: 6, ratchets: rolledOn(3), hold: HOLD };
    const hits = play({ sequencer, part: { regions: [{ start: 0, duration: 24 }] } });
    expectHits(hits, [hit(0), hit(6), hit(12), ...[18, 19.5, 21, 22.5].map((t) => hit(t, 1.5))]);
  });
});
