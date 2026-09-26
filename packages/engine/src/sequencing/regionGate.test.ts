/**
 * The region gate (#705): what a generator sees of the transport through
 * its part's regions — local ticks at its divisor, the current chord, an
 * entry hook when the playhead comes in from outside and a leave hook on
 * the tick a region ends. Driven by a `TickTransport`, no audio.
 */
import { describe, expect, it } from 'vitest';

import type { Harmony } from '../harmony/harmonyTimeline';
import { RegionGate, type PartTickEvent } from './regionGate';
import { TICKS_PER_BAR, TickTransport } from './scheduler';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: 2 * BAR, degree: 0, size: 3 },
    { start: 2 * BAR, duration: 2 * BAR, degree: 5, size: 3 },
  ],
};

interface Log {
  seen: PartTickEvent[];
  hooks: string[];
}

function drive(
  regions: { start: number; duration: number }[],
  divisor: number,
  ticks: number,
): { log: Log; gate: RegionGate } {
  const transport = new TickTransport(120);
  const log: Log = { seen: [], hooks: [] };
  const gate = new RegionGate(
    transport,
    { regions, songTicks: SONG, harmony: HARMONY },
    {
      onEnter: (index, entryTick) => log.hooks.push(`enter ${index} @${entryTick}`),
      onLeave: (tick) => log.hooks.push(`leave @${tick}`),
    },
  );
  gate.subscribe(divisor, (event) => log.seen.push(event));
  for (let i = 0; i < ticks; i++) transport.advance(transport.transportSeconds);
  return { log, gate };
}

describe('RegionGate', () => {
  it('in the ∞ region it enters once at tick 0, never leaves, and rebases nothing', () => {
    const { log } = drive([{ start: 0, duration: SONG }], 6, SONG + 12);
    expect(log.hooks).toEqual(['enter 0 @0']);
    expect(log.seen.map((e) => e.tick)).toEqual(
      Array.from({ length: (SONG + 12) / 6 }, (_, i) => i * 6),
    );
    // The chord follows the transport tick even though the local tick keeps counting.
    expect(log.seen.find((e) => e.tick === SONG)?.chord?.event.degree).toBe(0);
    expect(log.seen.find((e) => e.tick === 2 * BAR)?.chord?.event.degree).toBe(5);
    expect(log.seen.find((e) => e.tick === SONG)?.step).toBe(SONG / 6);
  });

  it('a region entered mid-song restarts the local count, and its end fires leave on that tick', () => {
    const { log } = drive([{ start: BAR, duration: BAR }], 12, 2 * SONG);
    expect(log.hooks).toEqual(['enter 0 @96', 'leave @192', 'enter 0 @480', 'leave @576']);
    const first = log.seen.filter((e) => e.time < SONG * e.secondsPerTick);
    expect(first.map((e) => e.tick)).toEqual([0, 12, 24, 36, 48, 60, 72, 84]);
    expect(first[0]).toMatchObject({ tick: 0, step: 0, bar: 0, tickInBar: 0, regionIndex: 0 });
    // The local tick is since the entry; the chord is the song's at the transport tick.
    expect(first.every((e) => e.chord?.event.degree === 0)).toBe(true);
    // Every tick outside the region is swallowed.
    expect(log.seen.every((e) => e.tick < BAR)).toBe(true);
  });

  it('two adjacent regions: the boundary tick leaves the first and enters the second at local 0', () => {
    const { log } = drive(
      [
        { start: 0, duration: 2 * BAR },
        { start: 2 * BAR, duration: 2 * BAR },
      ],
      1,
      SONG + 1,
    );
    expect(log.hooks).toEqual([
      'enter 0 @0',
      'leave @192',
      'enter 1 @192',
      'leave @384',
      'enter 0 @384',
    ]);
    const boundary = log.seen.filter((e) => e.regionIndex === 1)[0];
    expect(boundary).toMatchObject({ tick: 0, regionIndex: 1 });
    expect(boundary?.chord?.event.degree).toBe(5);
  });

  it('reconfigure takes new regions live: the next tick reads them and no restart happens for the same entry', () => {
    const transport = new TickTransport(120);
    const hooks: string[] = [];
    const seen: number[] = [];
    const gate = new RegionGate(
      transport,
      { regions: [{ start: 0, duration: SONG }], songTicks: SONG, harmony: HARMONY },
      { onEnter: (i) => hooks.push(`enter ${i}`), onLeave: (t) => hooks.push(`leave @${t}`) },
    );
    gate.subscribe(1, (e) => seen.push(e.tick));
    for (let i = 0; i < 10; i++) transport.advance(0);
    gate.reconfigure({
      regions: [{ start: 0, duration: 2 * BAR }],
      songTicks: SONG,
      harmony: HARMONY,
    });
    for (let i = 0; i < 2 * BAR; i++) transport.advance(0);
    expect(hooks).toEqual(['enter 0', 'leave @192']);
    expect(seen).toHaveLength(2 * BAR);
    expect(gate.stateAt(2 * BAR)).toEqual({ live: false });
    expect(gate.stateAt(SONG + 5)).toEqual({ live: true, index: 0, entryTick: SONG, localTick: 5 });
  });

  it('refuses a divisor that is not a positive integer', () => {
    const gate = new RegionGate(new TickTransport(120), {
      regions: [],
      songTicks: SONG,
      harmony: HARMONY,
    });
    expect(() => gate.subscribe(0, () => {})).toThrow(RangeError);
  });
});
