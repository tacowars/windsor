/**
 * The harmony lane's playing mark across a repaint (windsor#8): the playhead
 * loop marks only when the tick moves, so a zoom repaint at a standing tick
 * must light the replacement block itself (`songTab.ts`'s `paintLanes` calls
 * `markPlayingBlock` after every repaint). Fakes stand in for the DOM nodes.
 */
import { describe, expect, it } from 'vitest';

import type { ArrangementDocument, Harmony, HarmonyEvent } from '@windsor/engine';
import { CHORD_SIZE_TRIAD, TICKS_PER_BAR } from '@windsor/engine';
import { eventLabel } from './harmonyLaneModel';
import { markPlayingBlock } from './songHarmonyLane';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
const ev = (start: number, duration: number, degree: number): HarmonyEvent => ({
  start,
  duration,
  degree,
  size: CHORD_SIZE_TRIAD,
});
const harmony: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [ev(0, BAR, 0), ev(BAR, BAR, 3), ev(2 * BAR, 2 * BAR, 4)],
};
const doc = { harmony } as unknown as ArrangementDocument;

type FakeBlock = HTMLElement & { lit(): boolean };

/** A fake `.hblk` with the two things `markPlayingBlock` touches: its dataset and class list. */
function fakeBlock(event: number): FakeBlock {
  const classes = new Set<string>();
  return {
    dataset: { event: String(event) },
    classList: {
      toggle: (name: string, on: boolean): boolean => {
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    lit: () => classes.has('playing'),
  } as unknown as FakeBlock;
}

/** A fake lanes grid holding one freshly painted, unlit block per event. */
function paintedLanes(): { lanes: HTMLElement; blocks: FakeBlock[] } {
  const blocks = harmony.events.map((_, i) => fakeBlock(i));
  return { lanes: { querySelectorAll: () => blocks } as unknown as HTMLElement, blocks };
}

describe('the playing chord across a repaint', () => {
  it('lights the replacement block at an unchanged tick', () => {
    const tick = BAR + BAR / 2;
    const before = paintedLanes();
    markPlayingBlock(before.lanes, doc, SONG, tick);
    expect(before.blocks.map((b) => b.lit())).toEqual([false, true, false]);
    const after = paintedLanes();
    expect(after.blocks.some((b) => b.lit())).toBe(false);
    markPlayingBlock(after.lanes, doc, SONG, tick);
    expect(after.blocks.map((b) => b.lit())).toEqual([false, true, false]);
  });
});

describe("a chromatic block's label (windsor#332 decision 8)", () => {
  it('reads G# maj / ♭VI · triad for a flat-six major in C major', () => {
    const major: Harmony = { root: 0, scale: 'major', events: [] };
    const label = eventLabel(major, { ...ev(0, BAR, 5), quality: 'maj', accidental: -1 });
    // The two lines a `.hblk` draws: the name, then numeral · size.
    expect([label.name, `${label.numeral} · ${label.sizeTag}`]).toEqual(['G# maj', '♭VI · triad']);
  });
});
