/**
 * A Roll recording take (windsor#662, record `2026-10-09-roll-recording`
 * decisions 3–9): the onset, the cuts that freeze a length without writing
 * it, gaps and a second region, jumps, the end, and the write.
 */
import type { RollNote, RollSequencerConfig } from '@windsor/engine';
import { ROLL_NOTES_MAX } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { mergeTake, RollTake, type TakeRegion } from './rollTake';

/** Region 0 at 96 looping 48 ticks and ending at 284 (inside its fourth loop); a gap; region 1 at 384. */
const REGIONS: TakeRegion[] = [
  { start: 96, duration: 188, loopTicks: 48 },
  { start: 384, duration: 96, loopTicks: 96 },
];

const n = (tick: number, ticks: number, pitch: number, velocity?: number): RollNote =>
  velocity === undefined ? { tick, ticks, pitch } : { tick, ticks, pitch, velocity };

/** The computer keyboard's source, for the tests with one source. */
const K = 'KeyA';

/** The playhead run from `from` to `to`, a tick at a time. */
function play(take: RollTake, from: number, to: number): void {
  for (let tick = from; tick <= to; tick++) take.advance(tick);
}

describe('RollTake', () => {
  it('stamps the onset at the region’s local tick, modulo its loop, and keeps velocity below 1', () => {
    const take = new RollTake(REGIONS);
    take.press(K, 60, 1, 100);
    take.release(K, 60, 106);
    take.press(K, 62, 0.5, 96 + 50);
    take.release(K, 62, 150);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(4, 6, 60), n(2, 4, 62, 0.5)] }]);
    expect(take.drain()).toEqual([]);
  });

  it('freezes a note at its loop’s end and hands it out only on release, past two whole loops', () => {
    const take = new RollTake(REGIONS);
    take.press(K, 60, 1, 100);
    play(take, 100, 110);
    expect(take.held()).toEqual([
      { source: K, regionIndex: 0, pitch: 60, velocity: 1, tick: 4, ticks: 10 },
    ]);
    play(take, 111, 100 + 2 * 48 + 10);
    expect(take.held()[0]?.ticks).toBe(48 - 4);
    expect(take.drain()).toEqual([]);
    take.release(K, 60, 210);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(4, 44, 60)] }]);
  });

  it('cuts a note at its region’s end and waits for its release', () => {
    const take = new RollTake(REGIONS);
    take.press(K, 60, 1, 280);
    play(take, 280, 300);
    expect(take.held()[0]).toMatchObject({ tick: 40, ticks: 4 });
    expect(take.drain()).toEqual([]);
    take.release(K, 60, 300);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(40, 4, 60)] }]);
  });

  it('ignores a press in a gap and records again in the next region, handing notes to both', () => {
    const take = new RollTake(REGIONS);
    take.press(K, 60, 1, 270);
    take.release(K, 60, 276);
    take.press(K, 64, 1, 300);
    expect(take.held()).toEqual([]);
    take.release(K, 64, 310);
    take.press(K, 67, 1, 390);
    take.release(K, 67, 402);
    expect(take.drain()).toEqual([
      { regionIndex: 0, notes: [n(270 - 96 - 3 * 48, 6, 60)] },
      { regionIndex: 1, notes: [n(6, 12, 67)] },
    ]);
  });

  it('ends a held pitch struck again at the new press, as a struck key restarts', () => {
    const take = new RollTake(REGIONS);
    take.press(K, 60, 1, 100);
    take.press(K, 60, 1, 106);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(4, 6, 60)] }]);
    expect(take.held()).toMatchObject([{ tick: 10, pitch: 60 }]);
  });

  it('holds one pitch from two sources apart, each released by its own source', () => {
    const take = new RollTake([{ start: 0, duration: 96, loopTicks: 96 }]);
    take.press('midi:a:60', 60, 1, 0);
    take.press('midi:b:60', 60, 1, 5);
    take.release('midi:a:60', 60, 10);
    expect(take.held()).toMatchObject([{ source: 'midi:b:60', tick: 5 }]);
    take.release('midi:b:60', 60, 15);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(0, 10, 60), n(5, 10, 60)] }]);
  });

  it('on a jump back, freezes every held note at the last tick seen, pending until released', () => {
    const take = new RollTake(REGIONS);
    take.press(K, 60, 1, 100);
    play(take, 100, 130);
    // Pressed after the jump, before the playhead saw it: the new pass's note, not cut.
    take.press(K, 64, 1, 98);
    take.advance(100);
    play(take, 101, 110);
    expect(take.held()).toMatchObject([
      { pitch: 60, ticks: 30 },
      { pitch: 64, tick: 2, ticks: 12 },
    ]);
    expect(take.drain()).toEqual([]);
    take.release(K, 60, 111);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(4, 30, 60)] }]);
  });

  it('on a forward seek, cut() freezes every held note at the last tick heard, pending until released', () => {
    const take = new RollTake([{ start: 0, duration: 384, loopTicks: 384 }]);
    take.press(K, 60, 1, 0);
    play(take, 0, 10);
    take.cut(10);
    play(take, 100, 104);
    expect(take.held()).toMatchObject([{ pitch: 60, ticks: 10 }]);
    expect(take.drain()).toEqual([]);
    take.release(K, 60, 105);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(0, 10, 60)] }]);
  });

  it('cut() leaves the take open: a later press still records', () => {
    const take = new RollTake([{ start: 0, duration: 384, loopTicks: 384 }]);
    take.press(K, 60, 1, 0);
    play(take, 0, 10);
    take.cut(10);
    play(take, 100, 102);
    take.press(K, 64, 1, 102);
    play(take, 103, 110);
    take.release(K, 64, 110);
    take.release(K, 60, 110);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(102, 8, 64), n(0, 10, 60)] }]);
  });

  it('end() cuts every growing note at its tick and finishes every pending one', () => {
    const take = new RollTake(REGIONS);
    take.press(K, 60, 1, 100);
    play(take, 100, 120);
    take.advance(96);
    take.press(K, 64, 1, 98);
    play(take, 98, 104);
    take.end(103);
    expect(take.held()).toEqual([]);
    expect(take.drain()).toEqual([{ regionIndex: 0, notes: [n(4, 20, 60), n(2, 5, 64)] }]);
  });
});

/** A 4-bar roll. */
const roll = (notes: RollNote[]): RollSequencerConfig => ({ loopTicks: 384, notes });

/** `ROLL_NOTES_MAX` one-tick notes: every tick of the loop on pitches 24 up; the last, 29 at 127. */
const FULL = Array.from({ length: ROLL_NOTES_MAX }, (_, i) =>
  n(i % 384, 1, 24 + Math.floor(i / 384)),
);

describe('mergeTake', () => {
  it('replaces a note at the same tick and pitch, and trims an earlier overlap at a pitch', () => {
    const merged = mergeTake(roll([n(0, 12, 60), n(24, 6, 62)]), [n(24, 10, 62, 0.5), n(6, 6, 60)]);
    expect(merged).toEqual({
      config: roll([n(0, 6, 60), n(6, 6, 60), n(24, 10, 62, 0.5)]),
      full: false,
    });
  });

  it('refuses the notes past the cap and says the roll is full', () => {
    const merged = mergeTake(roll(FULL.slice(1)), [n(200, 4, 100), n(210, 4, 101)]);
    expect(merged.full).toBe(true);
    expect(merged.config.notes).toHaveLength(ROLL_NOTES_MAX);
    expect(merged.config.notes.some((note) => note.pitch === 101)).toBe(false);
  });

  it('writes a replacement into a full roll, keeping the count', () => {
    const merged = mergeTake(roll(FULL), [n(127, 12, 29, 0.5)]);
    expect(merged.full).toBe(true);
    expect(merged.config.notes).toHaveLength(ROLL_NOTES_MAX);
    const at = merged.config.notes.filter((note) => note.tick === 127 && note.pitch === 29);
    expect(at).toEqual([n(127, 12, 29, 0.5)]);
  });
});
