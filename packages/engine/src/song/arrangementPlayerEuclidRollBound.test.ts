/**
 * A ratchet's roll stays inside what the transport plays next (windsor#355):
 * its hits are queued at once, spaced across the whole step's swung span.
 * Where the region the hit came from ends, or the loop jumps, inside the
 * step, the roll keeps that spacing and drops the hits that would start at
 * or past the boundary; each survivor is held `min(hold, spacing, time left)`.
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
/** Step 3's ×4 roll on 18 at 1.5-tick spacing, cut 2 ticks in: its 2nd hit has half a tick left. */
const CUT_ON_20 = [hit(18, 1.5), hit(19.5, 0.5)];

describe('a roll stops at its region’s end and the loop’s jump (windsor#355)', () => {
  it('a ×4 roll cut between its 2nd and 3rd hits plays 2 at the full spacing', () => {
    // Steps at 0, 6, 12 and 18; the region ends at 20, before the gap.
    const sequencer = { pattern: ALL_ON, divisor: 6, ratchets: rolledOn(3), hold: HOLD };
    const hits = play({ sequencer, part: { regions: [{ start: 0, duration: 20 }] } });
    expectHits(hits, [hit(0), hit(6), hit(12), ...CUT_ON_20]);
  });

  it('a last-step roll right before another region stops where that region starts', () => {
    const regions = [
      { start: 0, duration: 20 },
      { start: 20, duration: 76 },
    ];
    const sequencer = { pattern: ALL_ON, divisor: 6, ratchets: rolledOn(3), hold: HOLD };
    const hits = play({ sequencer, part: { regions } }).filter(([start]) => start < 27);
    // The second region re-enters on 20: its own step 0 there, step 1 on 26.
    expectHits(hits, [hit(0), hit(6), hit(12), ...CUT_ON_20, hit(20), hit(26)]);
  });

  it('a roll straddling the loop’s end drops the hits from the jump on', () => {
    // Steps every 16 ticks, spacing 4; the loop jumps from 24 back to 0, on the roll's 3rd hit.
    const sequencer = { pattern: ALL_ON, divisor: 16, ratchets: rolledOn(1), hold: HOLD };
    const transport = { loop: { start: 0, end: 24, on: true } };
    const hits = play({ sequencer, transport }).filter(([start]) => start < 48);
    const roll = (at: number): Array<[number, number]> => [hit(at, 4), hit(at + 4, 4)];
    // Each pass replays from step 0: on 0 and 16, then on 24 and 40 in time.
    expectHits(hits, [hit(0), ...roll(16), hit(24), ...roll(40)]);
  });

  it('a ×4 roll in a one-tick region plays only its first hit, held one tick', () => {
    // The spacing, 1.5 ticks, is longer than the region.
    const sequencer = { pattern: ALL_ON, divisor: 6, ratchets: rolledOn(0), hold: HOLD };
    const hits = play({ sequencer, part: { regions: [{ start: 0, duration: 1 }] } });
    expectHits(hits, [hit(0, 1)]);
  });

  it('a roll with room to spare keeps the whole step', () => {
    const sequencer = { pattern: ALL_ON, divisor: 6, ratchets: rolledOn(3), hold: HOLD };
    const hits = play({ sequencer, part: { regions: [{ start: 0, duration: 24 }] } });
    expectHits(hits, [hit(0), hit(6), hit(12), ...[18, 19.5, 21, 22.5].map((t) => hit(t, 1.5))]);
  });
});
