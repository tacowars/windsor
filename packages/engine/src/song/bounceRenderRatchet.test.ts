/**
 * Bounce to Roll's ratchets (windsor#740, record `2026-10-11-bounce-to-roll`
 * decision 4, "Ratchet" and "Ratchet hits on one tick"; windsor#755, record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 11). A ratchet one
 * note plays exactly is written as that note ×N, nothing rounded and no
 * hit lost. One that falls back (here, a tie past the step) keeps the old
 * record's three worked ratchets, rounded and merged as it works them, and
 * the parity its Consequences ask for against the hits `ArrangementPlayer`
 * plays.
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
  TIE,
} from '../__fixtures__/bounceRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { Transport } from './arrangement';
import { DIVISORS } from '../sequencing/scheduler';

const SWUNG: Partial<Transport> = { swing: { amount: 75, grid: 16 } };
const A1 = 33;

/** A Grid line of one step ratcheted ×`ratchet` at `divisor`, then `next`. */
const ratchetSong = (
  divisor: number,
  transport: Partial<Transport> = {},
  next = REST,
  ratchet = 4,
) => bounceSong(gridSpec([gridNote(0, { ratchet }), next], { divisor }), { transport });

const sounding = (calls: readonly Call[]): Call[] =>
  calls.filter((call) => call.kind === 'noteOn' || call.kind === 'trigger');

describe('a ratchet one note plays exactly is that note ×N (windsor#755)', () => {
  it('×4 at 1/16, ×4 at 1/8 under 75% sixteenth swing, and ×4 at 1/32: one note, nothing rounded or lost', () => {
    const cases: [number, Partial<Transport>][] = [
      [DIVISORS.sixteenth, {}],
      [DIVISORS.eighth, SWUNG],
      [DIVISORS.thirtySecond, {}],
    ];
    for (const [divisor, transport] of cases) {
      const { notes, counts } = render(ratchetSong(divisor, transport));
      expect(span(notes[0]!)).toEqual([0, divisor, A1]);
      expect(notes[0]).toMatchObject({ ratchet: 4, marks: { rounded: 0, lost: 0 } });
      expect(notes[1]?.tick).toBe(2 * divisor);
      expect(counts).toMatchObject({ ticksRounded: 0, ratchetHitsLost: 0 });
    }
  });

  it('a ratchet of 3 at 1/16 is one note ×3', () => {
    const { notes } = render(ratchetSong(DIVISORS.sixteenth, {}, REST, 3));
    expect(notes[0]).toMatchObject({ tick: 0, ticks: 6, pitch: A1, ratchet: 3 });
  });
});

describe('a ratchet of 4 that falls back, held by a tie, as the old record works it', () => {
  it('straight at 1/16: 0–2, 2–3, 3–5, 5–12, and 4 ticks rounded', () => {
    const { notes, counts } = render(ratchetSong(DIVISORS.sixteenth, {}, TIE));
    expect(notes.slice(0, 4).map(span)).toEqual([
      [0, 2, A1],
      [2, 3, A1],
      [3, 5, A1],
      [5, 12, A1],
    ]);
    expect(notes.slice(0, 4).map((note) => note.marks.rounded)).toEqual([1, 1, 1, 1]);
    expect(notes.some((note) => note.ratchet)).toBe(false);
    // Four bars of the two-step line: four of these in each of 32 ratcheted steps.
    expect(counts).toMatchObject({ ticksRounded: 4 * 32, ratchetHitsLost: 0 });
  });

  it('at 1/8 under 75% sixteenth swing: 0–2, 2–4, 4–6, 6–24, nothing rounded', () => {
    const { notes, counts } = render(ratchetSong(DIVISORS.eighth, SWUNG, TIE));
    expect(notes.slice(0, 4).map(span)).toEqual([
      [0, 2, A1],
      [2, 4, A1],
      [4, 6, A1],
      [6, 24, A1],
    ]);
    expect(counts.ticksRounded).toBe(0);
  });

  it('at 1/32: three notes, 0–1, 1–2 and 2–6, one hit lost and 5 ticks rounded', () => {
    const song = bounceSong(gridSpec([gridNote(0, { ratchet: 4 }), TIE], { divisor: 3 }), {
      regions: [{ start: 0, duration: 6 }],
    });
    const { notes, counts } = render(song);
    expect(notes.map(span)).toEqual([
      [0, 1, A1],
      [1, 2, A1],
      [2, 6, A1],
    ]);
    expect(notes.map((note) => note.marks.lost)).toEqual([0, 0, 1]);
    expect(counts).toMatchObject({ notes: 3, ticksRounded: 5, ratchetHitsLost: 1 });
  });
});

describe('ratchets that fall back, against the played part (the old record’s Consequences)', () => {
  it('a swung eighth-note ×4 across the off-beat sounds its hits at the engine’s times', () => {
    const song = ratchetSong(DIVISORS.eighth, SWUNG, TIE);
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
    const song = bounceSong(gridSpec([gridNote(0, { ratchet: 4 }), TIE], { divisor: 3 }));
    const { notes, counts } = render(song);
    const hits = sounding(playRegion(song).calls);
    expect(hits).toHaveLength(4 * 64);
    expect(notes).toHaveLength(3 * 64);
    expect(counts.ratchetHitsLost).toBe(64);
    expect(notes.length + counts.ratchetHitsLost).toBe(hits.length);
  });
});
