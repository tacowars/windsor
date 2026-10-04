/**
 * Where a press lands on the Roll (windsor#603): the resize edge, a chord's
 * overlapping stems, the lane's velocity, a box's rows and edge scroll.
 */
import type { RollNote } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { auditionFrom } from './rollAudition';
import { boxPitches, edgeScroll, laneVelocity, onResizeEdge, stemAt } from './rollHit';
import { stemPx } from './rollNoteLook';

const LANE = { pxPerTick: 1, loop: 96, lanePx: 34 };

describe('onResizeEdge', () => {
  it('is the last 6 px, or a third of a short note', () => {
    expect(onResizeEdge(45, 50)).toBe(true);
    expect(onResizeEdge(44, 50)).toBe(false);
    expect(onResizeEdge(7, 9)).toBe(true);
    expect(onResizeEdge(5, 9)).toBe(false);
  });
});

describe('stemAt', () => {
  /** A chord at one onset: three stems on one x at three heights. */
  const chord: RollNote[] = [
    { tick: 24, ticks: 6, pitch: 57, velocity: 0.2 },
    { tick: 24, ticks: 6, pitch: 60, velocity: 0.5 },
    { tick: 24, ticks: 6, pitch: 64, velocity: 0.9 },
  ];
  const topOf = (v: number): number => LANE.lanePx - stemPx(v, LANE.lanePx);

  it('in a chord takes the stem whose top is nearest the press', () => {
    chord.forEach((note, i) => {
      expect(stemAt(chord, { x: 25, y: topOf(note.velocity ?? 1) }, LANE)).toBe(i);
    });
  });

  it('takes nothing out of reach, or past the loop', () => {
    expect(stemAt(chord, { x: 32, y: 10 }, LANE)).toBeNull();
    expect(stemAt([{ tick: 100, ticks: 6, pitch: 60 }], { x: 100, y: 10 }, LANE)).toBeNull();
    expect(stemAt([], { x: 0, y: 0 }, LANE)).toBeNull();
  });
});

describe('laneVelocity', () => {
  it('reads a stem top’s height back as its velocity, so a press on a stem leaves it where it is', () => {
    for (const v of [0.2, 0.5, 1]) {
      expect(laneVelocity(LANE.lanePx - stemPx(v, LANE.lanePx), LANE.lanePx)).toBeCloseTo(v);
    }
  });
});

describe('boxPitches', () => {
  it('names the rows a box touches, whichever way it was drawn', () => {
    const rows = [
      { pitch: 64, top: 0, h: 7, thin: false },
      { pitch: 63, top: 7, h: 3, thin: true },
      { pitch: 62, top: 10, h: 7, thin: false },
    ];
    expect([...boxPitches(rows, 12, 5)]).toEqual([64, 63, 62]);
    expect([...boxPitches(rows, 8, 9)]).toEqual([63]);
  });
});

describe('edgeScroll', () => {
  it('scrolls back at the start, on at the end, and not between', () => {
    expect(edgeScroll(0, 400)).toBe(-14);
    expect(edgeScroll(200, 400)).toBe(0);
    expect(edgeScroll(400, 400)).toBe(14);
    expect(edgeScroll(-50, 400)).toBe(-14);
    expect(edgeScroll(0, 40)).toBe(0);
  });
});

describe('auditionFrom', () => {
  it('is on unless storage holds off', () => {
    expect(auditionFrom(null)).toBe(true);
    expect(auditionFrom('on')).toBe(true);
    expect(auditionFrom('off')).toBe(false);
  });
});
