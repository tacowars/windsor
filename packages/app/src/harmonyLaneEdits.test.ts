/**
 * The harmony track's region edits (windsor#550): `+` halves a chord on the
 * song's bar lines, a seam roll moves one boundary only, and Alt-click
 * splits where each half keeps a beat. Every expectation is an expression
 * of the engine's tick constants.
 */
import { describe, expect, it } from 'vitest';

import type { HarmonyEvent } from '@windsor/engine';
import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD, PPQ, TICKS_PER_BAR } from '@windsor/engine';
import {
  chordGrid,
  halveEvent,
  halvingTarget,
  rollSeam,
  snapToGrid,
  splitEventAt,
} from './harmonyLaneEdits';

const BAR = TICKS_PER_BAR;
const ev = (start: number, duration: number, degree = 0): HarmonyEvent => ({
  start,
  duration,
  degree,
  size: CHORD_SIZE_TRIAD,
});
const spans = (events: readonly HarmonyEvent[]): [number, number][] =>
  events.map((e) => [e.start, e.duration]);

describe('+ halves a chord', () => {
  it('cuts one chord at its middle bar and selects the right half', () => {
    expect(spans(halveEvent([ev(0, 64 * BAR)], 0)?.events ?? [])).toEqual([
      [0, 32 * BAR],
      [32 * BAR, 32 * BAR],
    ]);
    const three = halveEvent([ev(0, 3 * BAR)], 0);
    expect(spans(three?.events ?? [])).toEqual([
      [0, BAR],
      [BAR, 2 * BAR],
    ]);
    expect(three?.index).toBe(1);
  });

  it("rounds down to the song's bar lines, else a beat line, and is refused under two beats", () => {
    // A chord from beat 2 of bar 1 to bar 5: its middle (2.5 bars in) rounds down to bar 3's line.
    const offBeat = [ev(0, PPQ), ev(PPQ, 4 * BAR - PPQ, 4)];
    expect(spans(halveEvent(offBeat, 1)?.events ?? []).slice(1)).toEqual([
      [PPQ, 2 * BAR - PPQ],
      [2 * BAR, 2 * BAR],
    ]);
    // One bar: no bar line inside, so the middle beat.
    expect(spans(halveEvent([ev(BAR, BAR)], 0)?.events ?? [])).toEqual([
      [BAR, 2 * PPQ],
      [BAR + 2 * PPQ, 2 * PPQ],
    ]);
    expect(spans(halveEvent([ev(0, 2 * PPQ)], 0)?.events ?? [])).toEqual([
      [0, PPQ],
      [PPQ, PPQ],
    ]);
    expect(halveEvent([ev(0, PPQ)], 0)).toBeNull();
    expect(halveEvent([ev(0, 2 * PPQ - 1)], 0)).toBeNull();
  });

  it('cuts on the bar of the song’s meter: 7/8 bars of 84 ticks', () => {
    const seven = 84;
    expect(spans(halveEvent([ev(0, 4 * seven)], 0, seven)?.events ?? [])).toEqual([
      [0, 2 * seven],
      [2 * seven, 2 * seven],
    ]);
  });

  it('copies the chord into the new half, quality and accidental included', () => {
    const chromatic: HarmonyEvent = {
      ...ev(0, 4 * BAR, 6),
      size: CHORD_SIZE_SEVENTH,
      quality: 'maj7',
      accidental: 1,
    };
    const out = halveEvent([chromatic], 0)?.events ?? [];
    expect(out[1]).toEqual({ ...chromatic, start: 2 * BAR, duration: 2 * BAR });
  });

  it('halves the selected chord, or the rightmost when none is', () => {
    const events = [ev(0, BAR), ev(BAR, BAR), ev(2 * BAR, 2 * BAR)];
    expect(halvingTarget(events, 1)).toBe(1);
    expect(halvingTarget(events, null)).toBe(2);
    expect(halvingTarget(events, 7)).toBe(2);
  });
});

describe('a seam is a roll edit', () => {
  const FOUR = [
    ev(0, 4 * BAR, 0),
    ev(4 * BAR, 4 * BAR, 5),
    ev(8 * BAR, 4 * BAR, 3),
    ev(12 * BAR, 4 * BAR, 4),
  ];

  it('moves only the boundary between the two chords', () => {
    const out = rollSeam(FOUR, 1, 6 * BAR);
    expect(spans(out)).toEqual([
      [0, 4 * BAR],
      [4 * BAR, 2 * BAR],
      [6 * BAR, 6 * BAR],
      [12 * BAR, 4 * BAR],
    ]);
    expect(out[0]).toBe(FOUR[0]);
    expect(out[3]).toBe(FOUR[3]);
  });

  it('stops a beat short of either chord’s other end, the song’s last bar included', () => {
    expect(spans(rollSeam(FOUR, 2, 20 * BAR)).slice(2)).toEqual([
      [8 * BAR, 8 * BAR - PPQ],
      [16 * BAR - PPQ, PPQ],
    ]);
    expect(spans(rollSeam(FOUR, 0, -BAR)).slice(0, 2)).toEqual([
      [0, PPQ],
      [PPQ, 8 * BAR - PPQ],
    ]);
  });

  it('snaps to the bar, or to a beat (PPQ) with Shift, in any meter', () => {
    expect(snapToGrid(BAR * 1.4, chordGrid(false))).toBe(BAR);
    expect(snapToGrid(BAR * 1.6, chordGrid(false))).toBe(2 * BAR);
    expect(snapToGrid(PPQ * 2.4, chordGrid(true))).toBe(2 * PPQ);
    expect(snapToGrid(100, chordGrid(false, 84))).toBe(84);
    expect(snapToGrid(100, chordGrid(true, 84))).toBe(4 * PPQ);
  });

  it('rolls the last chord’s wrapped hold into the first chord when the first starts late', () => {
    const late = [ev(BAR, BAR, 1), ev(2 * BAR, 2 * BAR, 4)];
    expect(spans(rollSeam(late, 1, 2 * PPQ))).toEqual([
      [2 * PPQ, 2 * BAR - 2 * PPQ],
      [2 * BAR, 2 * BAR],
    ]);
    expect(spans(rollSeam(late, 1, 0))[0]).toEqual([PPQ, 2 * BAR - PPQ]);
    expect(spans(rollSeam([ev(BAR, 3 * BAR)], 0, 0))).toEqual([[BAR, 3 * BAR]]);
  });

  it('leaves a single chord alone: it has no seam', () => {
    expect(rollSeam([ev(0, 4 * BAR)], 0, 2 * BAR)).toEqual([ev(0, 4 * BAR)]);
  });
});

describe('Alt-click splits a chord', () => {
  it('at the snapped pointer, the right half selected', () => {
    const out = splitEventAt([ev(0, 4 * BAR, 2)], 0, 3 * BAR);
    expect(spans(out?.events ?? [])).toEqual([
      [0, 3 * BAR],
      [3 * BAR, BAR],
    ]);
    expect(out?.index).toBe(1);
  });

  it('only where each half keeps a beat', () => {
    expect(splitEventAt([ev(0, 4 * BAR)], 0, 0)).toBeNull();
    expect(splitEventAt([ev(0, 4 * BAR)], 0, PPQ - 1)).toBeNull();
    expect(splitEventAt([ev(0, 4 * BAR)], 0, 4 * BAR - PPQ + 1)).toBeNull();
    expect(splitEventAt([ev(0, PPQ)], 0, PPQ / 2)).toBeNull();
    expect(splitEventAt([ev(0, 4 * BAR)], 0, PPQ)?.events[0]?.duration).toBe(PPQ);
  });

  it('a Shift+Alt-click in the wrapped hold inserts a copy of the last chord up to the first', () => {
    // The first chord starts at bar 3, so the last (degree 4) holds over [0, 2 bars).
    const late = [ev(2 * BAR, BAR, 1), ev(3 * BAR, BAR, 4)];
    const tick = snapToGrid(BAR + PPQ * 1.2, chordGrid(true));
    const out = splitEventAt(late, 1, tick);
    expect(out?.index).toBe(0);
    expect(out?.events).toEqual([ev(BAR + PPQ, BAR - PPQ, 4), ...late]);
  });

  it('does nothing within a beat of either end of the wrapped hold', () => {
    const late = [ev(2 * BAR, BAR, 1), ev(3 * BAR, BAR, 4)];
    for (const tick of [0, PPQ - 1, 2 * BAR - PPQ + 1]) {
      expect(splitEventAt(late, 1, tick)).toBeNull();
    }
    expect(splitEventAt(late, 1, PPQ)?.events[0]?.start).toBe(PPQ);
  });
});
