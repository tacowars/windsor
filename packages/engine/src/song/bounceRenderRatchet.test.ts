/**
 * Bounce to Roll's ratchets (windsor#740, record `2026-10-11-bounce-to-roll`
 * decision 4, "Ratchet" and "Ratchet hits on one tick"): the three worked
 * ratchets, and the parity the record's Consequences ask for, against the
 * hits `ArrangementPlayer` plays.
 */
import { describe, expect, it } from 'vitest';

import {
  bounceSong,
  gridNote,
  gridSpec,
  playRegion,
  render,
  REST,
  span,
} from '../__fixtures__/bounceRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { Transport } from './arrangement';
import { DIVISORS } from '../sequencing/scheduler';

const SWUNG: Partial<Transport> = { swing: { amount: 75, grid: 16 } };
const A1 = 33;

/** A Grid line of one ratcheted step at `divisor`, then a rest. */
const ratchetSong = (divisor: number, transport: Partial<Transport> = {}) =>
  bounceSong(gridSpec([gridNote(0, { ratchet: 4 }), REST], { divisor }), { transport });

const sounding = (calls: readonly Call[]): Call[] =>
  calls.filter((call) => call.kind === 'noteOn' || call.kind === 'trigger');

describe('a ratchet of 4, as the record works it', () => {
  it('straight at 1/16: 0–2, 2–3, 3–5, 5–6, and 4 ticks rounded', () => {
    const { notes, counts } = render(ratchetSong(DIVISORS.sixteenth));
    expect(notes.slice(0, 4).map(span)).toEqual([
      [0, 2, A1],
      [2, 3, A1],
      [3, 5, A1],
      [5, 6, A1],
    ]);
    expect(notes.slice(0, 4).map((note) => note.marks.rounded)).toEqual([1, 1, 1, 1]);
    // Eight bars of the two-step line: four of these in each of 32 ratcheted steps.
    expect(counts).toMatchObject({ ticksRounded: 4 * 32, ratchetHitsLost: 0 });
  });

  it('at 1/8 under 75% sixteenth swing: 0–2, 2–4, 4–6, 6–12, nothing rounded', () => {
    const { notes, counts } = render(ratchetSong(DIVISORS.eighth, SWUNG));
    expect(notes.slice(0, 4).map(span)).toEqual([
      [0, 2, A1],
      [2, 4, A1],
      [4, 6, A1],
      [6, 12, A1],
    ]);
    expect(counts.ticksRounded).toBe(0);
  });

  it('at 1/32: three notes, 0–1, 1–2 and 2–3, one hit lost and 5 ticks rounded', () => {
    const song = bounceSong(gridSpec([gridNote(0, { ratchet: 4 }), REST], { divisor: 3 }), {
      regions: [{ start: 0, duration: 6 }],
    });
    const { notes, counts } = render(song);
    expect(notes.map(span)).toEqual([
      [0, 1, A1],
      [1, 2, A1],
      [2, 3, A1],
    ]);
    expect(notes.map((note) => note.marks.lost)).toEqual([0, 0, 1]);
    expect(counts).toMatchObject({ notes: 3, ticksRounded: 5, ratchetHitsLost: 1 });
  });

  it('a ratchet of 3 at 1/16, or of 4 at 1/8, divides evenly and rounds nothing', () => {
    const three = bounceSong(gridSpec([gridNote(0, { ratchet: 3 }), REST]));
    expect(render(three).notes.slice(0, 3).map(span)).toEqual([
      [0, 2, A1],
      [2, 4, A1],
      [4, 6, A1],
    ]);
    expect(render(three).counts.ticksRounded).toBe(0);
    expect(render(ratchetSong(DIVISORS.eighth)).counts.ticksRounded).toBe(0);
  });
});

describe('ratchets against the played part (the record’s Consequences)', () => {
  it('a swung eighth-note ×4 across the off-beat sounds its hits at the engine’s times', () => {
    const song = ratchetSong(DIVISORS.eighth, SWUNG);
    const { notes } = render(song);
    const { calls, transport } = playRegion(song);
    const spt = transport.secondsPerTick;
    const hits = sounding(calls);
    expect(hits).toHaveLength(notes.length);
    hits.forEach((hit, i) => {
      const note = notes[i]!;
      expect(note.pitch).toBe(hit.note);
      expect(transport.swungTicks(note.tick) * spt).toBeCloseTo(hit.time!, 12);
      // A closed hit's release sounds where the engine released it.
      if (hit.kind === 'trigger') {
        const release = transport.swungTicks(note.tick + note.ticks) * spt;
        expect(release).toBeCloseTo(hit.time! + hit.duration!, 12);
      }
    });
  });

  it('a 1/32 ×4 writes three notes where the engine played four hits, one counted lost', () => {
    const song = bounceSong(gridSpec([gridNote(0, { ratchet: 4 }), REST], { divisor: 3 }));
    const { notes, counts } = render(song);
    const hits = sounding(playRegion(song).calls);
    expect(hits).toHaveLength(4 * 64);
    expect(notes).toHaveLength(3 * 64);
    expect(counts.ratchetHitsLost).toBe(64);
    expect(notes.length + counts.ratchetHitsLost).toBe(hits.length);
  });
});
