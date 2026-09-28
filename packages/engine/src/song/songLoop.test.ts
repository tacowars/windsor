/**
 * `transport.loop` in the song document (windsor#15, record
 * `2026-09-28-song-loop-in-the-transport`): absent stays absent, present
 * round-trips, and a loop is ordered, snapped to the beat, at least a beat
 * long and inside the song, or off when nothing of it is left.
 */
import { describe, expect, it } from 'vitest';

import { makeArrangement } from './arrangementDocument';
import { fitLoopRange, playStartTick, tickLoopOf, withFittedLoop } from './songLoop';
import { PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';
import { KICK, song } from '../__fixtures__/documentCases';
import type { SongLoop } from './arrangement';

const BAR = TICKS_PER_BAR;
const roundTrip = (raw: unknown): ReturnType<typeof makeArrangement> =>
  makeArrangement(JSON.parse(JSON.stringify(raw)));
const withLoop = (loop: unknown, bars = 12): ReturnType<typeof makeArrangement> =>
  makeArrangement(song([KICK], { transport: { bpm: 100, bars, loop } }));

describe('fitLoopRange', () => {
  it('keeps a range on the beat inside the song', () => {
    expect(fitLoopRange(4 * BAR, 8 * BAR, 12 * BAR)).toEqual({ start: 4 * BAR, end: 8 * BAR });
  });

  it('orders, snaps to the nearest beat, and keeps at least one beat', () => {
    expect(fitLoopRange(8 * BAR, 4 * BAR, 12 * BAR)).toEqual({ start: 4 * BAR, end: 8 * BAR });
    expect(fitLoopRange(PPQ - 5, 3 * PPQ + 13, 12 * BAR)).toEqual({ start: PPQ, end: 4 * PPQ });
    expect(fitLoopRange(2 * PPQ, 2 * PPQ, 12 * BAR)).toEqual({ start: 2 * PPQ, end: 3 * PPQ });
  });

  it('clamps the end to the song, and has nothing when it starts at or past the end', () => {
    expect(fitLoopRange(4 * BAR, 8 * BAR, 6 * BAR)).toEqual({ start: 4 * BAR, end: 6 * BAR });
    expect(fitLoopRange(4 * BAR, 8 * BAR, 4 * BAR)).toBeNull();
    expect(fitLoopRange(4 * BAR - 1, 8 * BAR, 4 * BAR)).toBeNull();
  });
});

describe('transport.loop in the document', () => {
  it('leaves an old song without a loop without one: it imports and exports unchanged', () => {
    const first = makeArrangement(song([KICK], { transport: { bpm: 100, bars: 4 } }));
    expect(first.corrections).toEqual([]);
    expect('loop' in first.document.transport).toBe(false);
    expect(playStartTick(first.document.transport)).toBe(0);
    expect(tickLoopOf(first.document.transport)).toBeNull();
    const again = roundTrip(first.document);
    expect(JSON.stringify(again.document)).toBe(JSON.stringify(first.document));
  });

  it('round-trips a song with a loop, correction-free', () => {
    const loop: SongLoop = { start: 4 * BAR, end: 8 * BAR, on: true };
    const first = withLoop(loop);
    expect(first.corrections).toEqual([]);
    expect(first.document.transport.loop).toEqual(loop);
    const again = roundTrip(first.document);
    expect(again.document).toEqual(first.document);
    expect(again.corrections).toEqual([]);
    expect(playStartTick(first.document.transport)).toBe(4 * BAR);
    expect(tickLoopOf(first.document.transport)).toEqual({
      start: 4 * BAR,
      end: 8 * BAR,
      songTicks: 12 * BAR,
    });
  });

  it('keeps a loop that is off, and starts play at 0 for it', () => {
    const { document } = withLoop({ start: 4 * BAR, end: 8 * BAR, on: false });
    expect(document.transport.loop).toEqual({ start: 4 * BAR, end: 8 * BAR, on: false });
    expect(playStartTick(document.transport)).toBe(0);
    expect(tickLoopOf(document.transport)).toBeNull();
  });

  it('fits a loop off the grid or past the end, reported', () => {
    const snapped = withLoop({ start: 4 * BAR + 5, end: 20 * BAR, on: true });
    expect(snapped.document.transport.loop).toEqual({ start: 4 * BAR, end: 12 * BAR, on: true });
    expect(snapped.corrections).toEqual([
      `transport.loop: fitted ${4 * BAR + 5}–${20 * BAR} to ${4 * BAR}–${12 * BAR}`,
    ]);
  });

  it('turns off a loop left empty by a shorter song, reported', () => {
    const gone = withLoop({ start: 8 * BAR, end: 10 * BAR, on: true }, 6);
    expect('loop' in gone.document.transport).toBe(false);
    expect(gone.corrections).toEqual([
      `transport.loop: starts at or past the song's end (${6 * BAR}) — loop off`,
    ]);
  });

  it('defaults junk fields to the whole song, off', () => {
    const junk = withLoop({ on: 'yes', extra: 1 });
    expect(junk.document.transport.loop).toEqual({ start: 0, end: 12 * BAR, on: false });
    expect(junk.corrections).toEqual([
      'transport.loop.extra: unknown key dropped',
      'transport.loop.on: "yes" is not a boolean — using false',
    ]);
  });
});

describe('withFittedLoop (the live copy)', () => {
  it('writes an off whole-song loop into a song that has none, so a partial can merge', () => {
    const { document } = makeArrangement(song([KICK], { transport: { bpm: 100, bars: 4 } }));
    expect(withFittedLoop(document).transport.loop).toEqual({ start: 0, end: 4 * BAR, on: false });
  });
});
