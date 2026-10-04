/**
 * Where the Roll draws each note (windsor#602 decision 3): ghost repeats
 * past the loop, cut at the loop's end and at a region end that falls
 * mid-pass, and notes parked past the loop; only those in the view's window.
 */
import { describe, expect, it } from 'vitest';
import {
  type TickWindow,
  loopNoteCount,
  rollInstances,
  rollWindow,
  sounding,
  windowHolds,
} from './rollRepeats';

const BAR = 96;
/** The longest region a song holds: 256 bars of 4/4. */
const LONGEST = 256 * BAR;
const ALL = { from: 0, to: Infinity };

const layout = (loopTicks: number, regionTicks: number, within: TickWindow = ALL) => ({
  loopTicks,
  regionTicks,
  within,
});

describe('rollInstances', () => {
  it('repeats a 3-bar loop through an 8-bar region, the last pass cut at the region end', () => {
    const notes = [
      { tick: 0, ticks: 24, pitch: 60 },
      { tick: 2 * BAR + 72, ticks: 48, pitch: 64 },
    ];
    const drawn = rollInstances(notes, layout(3 * BAR, 8 * BAR));
    expect(drawn.filter((d) => d.index === 0).map((d) => [d.start, d.ticks, d.pass])).toEqual([
      [0, 24, 0],
      [288, 24, 1],
      [576, 24, 2],
    ]);
    // Held past the loop's end it is cut there (24 of its 48 ticks); the
    // third pass would start at 840, past the region's 768, so it is not drawn.
    expect(drawn.filter((d) => d.index === 1).map((d) => [d.start, d.ticks, d.pass])).toEqual([
      [264, 24, 0],
      [552, 24, 1],
    ]);
  });

  it('cuts a repeat that the region end falls inside', () => {
    const drawn = rollInstances([{ tick: 0, ticks: 96, pitch: 60 }], layout(2 * BAR, 3 * BAR - 24));
    expect(drawn.map((d) => [d.start, d.ticks])).toEqual([
      [0, 96],
      [192, 72],
    ]);
  });

  it('parks a note past the loop once, hollow where it lies, and draws none past the region', () => {
    const notes = [
      { tick: 5 * BAR, ticks: 400, pitch: 60 },
      { tick: 9 * BAR, ticks: 24, pitch: 62 },
    ];
    expect(rollInstances(notes, layout(4 * BAR, 8 * BAR))).toEqual([
      { index: 0, start: 480, ticks: 288, pass: 0, parked: true },
    ]);
  });

  it('lights what sounds at a tick, never a parked note', () => {
    const [note, ghost] = rollInstances([{ tick: 12, ticks: 12, pitch: 60 }], layout(BAR, 2 * BAR));
    expect(sounding(note!, 12)).toBe(true);
    expect(sounding(note!, 24)).toBe(false);
    expect(sounding(ghost!, 110)).toBe(true);
    const [parked] = rollInstances([{ tick: 120, ticks: 12, pitch: 60 }], layout(BAR, 2 * BAR));
    expect(sounding(parked!, 125)).toBe(false);
  });

  it('draws a one-tick loop over the longest region only inside the window', () => {
    const notes = Array.from({ length: 128 }, (_, pitch) => ({ tick: 0, ticks: 24, pitch }));
    const within = { from: 20_000, to: 20_600 };
    const drawn = rollInstances(notes, layout(1, LONGEST, within));
    expect(drawn).toHaveLength((within.to - within.from) * notes.length);
    expect(drawn.every((d) => d.start >= within.from && d.start < within.to)).toBe(true);
    expect(drawn[0]).toEqual({ index: 0, start: 20_000, ticks: 1, pass: 20_000, parked: false });
  });

  it('draws repeats packed tighter than a note can be drawn as one run per chord span', () => {
    const notes = Array.from({ length: 128 }, (_, pitch) => ({ tick: 0, ticks: 24, pitch }));
    const bars = Array.from({ length: 256 }, (_, bar) => bar * BAR);
    const dense = { ...layout(1, LONGEST), minTicks: 12, breaks: bars };
    const drawn = rollInstances(notes, dense);
    // The note itself, then a run to each bar line: 257 per note, not 24,576.
    expect(drawn).toHaveLength(notes.length * (1 + bars.length));
    const first = drawn.filter((d) => d.index === 0);
    expect(first.slice(0, 3).map((d) => [d.start, d.ticks, d.pass])).toEqual([
      [0, 1, 0],
      [1, 95, 1],
      [96, 96, 96],
    ]);
    // The runs leave no gap: together they span the whole region.
    expect(first.reduce((sum, d) => sum + d.ticks, 0)).toBe(LONGEST);
  });

  it('draws runs once the repeats would pass the budget, one to a note if the spans would too', () => {
    const notes = Array.from({ length: 128 }, (_, pitch) => ({ tick: 0, ticks: 24, pitch }));
    const bars = Array.from({ length: 256 }, (_, bar) => bar * BAR);
    const within = { from: 20_000, to: 20_600 };
    const capped = { ...layout(1, LONGEST, within), breaks: bars, budget: 2048 };
    // Six bar lines fall inside the window, so each note draws seven runs.
    expect(rollInstances(notes, capped)).toHaveLength(notes.length * 7);
    const wide = { ...capped, within: { from: 0, to: LONGEST } };
    // 256 spans to a note would pass the budget: one run to a note, and the note itself.
    const drawn = rollInstances(notes, wide);
    expect(drawn).toHaveLength(notes.length * 2);
    expect(drawn.slice(0, 2).map((d) => [d.start, d.ticks, d.pass])).toEqual([
      [0, 1, 0],
      [1, LONGEST - 1, 1],
    ]);
  });

  it('keeps a repeat that started before the window and still sounds in it', () => {
    const notes = [{ tick: 0, ticks: 48, pitch: 60 }];
    const drawn = rollInstances(
      notes,
      layout(2 * BAR, 8 * BAR, { from: 2 * BAR + 40, to: 3 * BAR }),
    );
    expect(drawn.map((d) => [d.start, d.pass])).toEqual([[2 * BAR, 1]]);
    expect(
      rollInstances(notes, layout(2 * BAR, 8 * BAR, { from: 2 * BAR + 48, to: 3 * BAR })),
    ).toEqual([]);
  });

  it('counts the notes the loop plays', () => {
    const notes = [0, 90, 100, 300].map((tick) => ({ tick, ticks: 6, pitch: 60 }));
    expect(loopNoteCount(notes, BAR, 2 * BAR)).toBe(2);
    expect(loopNoteCount(notes, 4 * BAR, 2 * BAR)).toBe(3);
  });
});

describe('rollWindow', () => {
  const view = { scrollPx: 1000, widthPx: 500, pxPerTick: 0.5, regionTicks: LONGEST };

  it('is the view and a screen either side, within the region', () => {
    expect(rollWindow(view)).toEqual({ from: 1000, to: 4000 });
    expect(rollWindow(view, 0)).toEqual({ from: 2000, to: 3000 });
    expect(rollWindow({ ...view, scrollPx: 0, regionTicks: 1500 })).toEqual({ from: 0, to: 1500 });
  });

  it('redraws once the view leaves what was drawn', () => {
    const drawn = rollWindow(view);
    expect(windowHolds(drawn, rollWindow({ ...view, scrollPx: 1400 }, 0))).toBe(true);
    expect(windowHolds(drawn, rollWindow({ ...view, scrollPx: 1600 }, 0))).toBe(false);
  });
});
