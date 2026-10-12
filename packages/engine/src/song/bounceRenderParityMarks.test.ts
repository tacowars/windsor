/**
 * Bounce to Roll's accents and ratchets against the player (windsor#755,
 * record `2026-10-12-roll-note-accent-and-ratchet` decision 11): each part
 * is played as generated, bounced, and played again as a Roll, and the two
 * must sound alike, hit for hit (`bounceParity.ts`). A ratchet one note
 * plays exactly is written as that note ×N; each fallback keeps its hits as
 * written notes, and is chosen so that its hits land on whole ticks, where
 * the written hits sound alike too.
 */
import { describe, expect, it } from 'vitest';

import { expectSameSound, playBoth, type BothPlays } from '../__fixtures__/bounceParity';
import { gridNote, gridSpec, REST, TIE } from '../__fixtures__/bounceRig';
import { ACID_SAW } from '../__fixtures__/bounceToRollRig';
import type { EuclideanSpec, RollSpec, Transport } from './arrangement';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { arpNote } from '../sequencing/arpSteps';
import { bassNote, DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import { DEFAULT_EUCLIDEAN_CONFIG } from '../sequencing/euclideanSequencer';
import { DEFAULT_FIGURE_CONFIG, figureNoteCell } from '../sequencing/figureSequencer';
import type { RollNote } from '../sequencing/rollSequencer';
import { DIVISORS } from '../sequencing/scheduler';

const SWUNG: Partial<Transport> = { swing: { amount: 75, grid: 16 } };
const ONE_BAR = [{ start: 0, duration: 96 }];
/** Seconds per straight tick at the rig's 120 bpm. */
const SPT = 60 / 120 / 24;

const notesOf = ({ part }: BothPlays, region = 0): readonly RollNote[] =>
  (part.regions[region]!.pattern as RollSpec).notes;

const summaryOf = ({ result }: BothPlays) => {
  if (!result.ok) throw new Error('refused');
  return result.summary;
};

/** Neither a hit lost nor a tick rounded. */
const EXACT = { ticksRounded: 0, ratchetHitsLost: 0, accentsLostMod: 0 };

describe('the Acid Saw line (the bounce record’s worked loop)', () => {
  it('sounds alike bounced, its four accents a bar written and nothing lost', () => {
    const grid = gridSpec(ACID_SAW, { accentVelocity: 0.2, accentMod: 1 });
    const both = playBoth(grid, { preset: 'acid-saw' });
    expectSameSound(both);
    expect(notesOf(both).filter((note) => note.accent)).toHaveLength(4);
    expect(summaryOf(both)).toMatchObject({ ...EXACT, notes: 12, velocity: 0.8 });
  });
});

describe('a Grid ratchet one note plays exactly is written as that note ×N', () => {
  const cases: [string, number, Partial<Transport>][] = [
    ['×4 at 1/16', DIVISORS.sixteenth, {}],
    ['×4 at 1/32', DIVISORS.thirtySecond, {}],
    ['×4 at 1/8 across 75% swing', DIVISORS.eighth, SWUNG],
  ];
  for (const [name, divisor, transport] of cases) {
    it(name, () => {
      const steps = [gridNote(0, { ratchet: 4 }), REST];
      const both = playBoth(gridSpec(steps, { divisor }), { transport });
      expectSameSound(both);
      expect(notesOf(both)[0]).toEqual({ tick: 0, ticks: divisor, pitch: 33, ratchet: 4 });
      expect(summaryOf(both)).toMatchObject(EXACT);
    });
  }

  it('an accented ×3 plays its accent on every hit, and slides into the next note on a mono patch', () => {
    const steps = [gridNote(0, { ratchet: 3, accent: true }), gridNote(2, { slide: true })];
    const both = playBoth(gridSpec(steps, { accentVelocity: 0.3, accentMod: 0.5 }), {
      preset: 'acid-saw',
      regions: ONE_BAR,
    });
    expectSameSound(both);
    // Step 2 slides from the ratchet's last hit: the writer lengthens it, so the ratchet falls back.
    expect(notesOf(both).some((note) => note.ratchet)).toBe(false);
  });
});

describe('a ratchet one note cannot play falls back to its hits, as written today', () => {
  it('a ratchet followed by a tie', () => {
    const steps = [gridNote(0, { ratchet: 4 }), TIE, REST, REST];
    const both = playBoth(gridSpec(steps, { divisor: DIVISORS.eighth }), { regions: ONE_BAR });
    expectSameSound(both);
    expect(notesOf(both).slice(0, 4)).toEqual([
      { tick: 0, ticks: 3, pitch: 33 },
      { tick: 3, ticks: 3, pitch: 33 },
      { tick: 6, ticks: 3, pitch: 33 },
      { tick: 9, ticks: 15, pitch: 33 },
    ]);
    expect(summaryOf(both)).toMatchObject(EXACT);
  });

  it('a ratchet whose next step slides, on a mono patch', () => {
    const steps = [gridNote(0, { ratchet: 4 }), gridNote(2, { slide: true }), REST, REST];
    const both = playBoth(gridSpec(steps, { divisor: DIVISORS.eighth }), {
      preset: 'acid-saw',
      regions: ONE_BAR,
    });
    expectSameSound(both);
    expect(notesOf(both).slice(0, 5)).toEqual([
      { tick: 0, ticks: 3, pitch: 33 },
      { tick: 3, ticks: 3, pitch: 33 },
      { tick: 6, ticks: 3, pitch: 33 },
      { tick: 9, ticks: 4, pitch: 33 },
      { tick: 12, ticks: 12, pitch: 36 },
    ]);
  });

  it('an Arp ratchet at gate 0.5', () => {
    const steps = [arpNote({ ratchet: 2 }), arpNote()];
    const arp = { kind: 'arp' as const, ...DEFAULT_ARP_CONFIG, divisor: DIVISORS.eighth, steps };
    const both = playBoth(arp, { regions: ONE_BAR });
    expectSameSound(both);
    expect(
      notesOf(both)
        .slice(0, 2)
        .map(({ tick, ticks }) => [tick, ticks]),
    ).toEqual([
      [0, 3],
      [6, 3],
    ]);
    expect(notesOf(both).some((note) => note.ratchet)).toBe(false);
  });

  it('an Arp ratchet at gate 1 is played exactly by one note, and written so', () => {
    const steps = [arpNote({ ratchet: 2 }), arpNote()];
    const arp = {
      kind: 'arp' as const,
      ...DEFAULT_ARP_CONFIG,
      divisor: DIVISORS.eighth,
      gate: 1,
      steps,
    };
    const both = playBoth(arp, { regions: ONE_BAR });
    expectSameSound(both);
    expect(notesOf(both)[0]).toMatchObject({ tick: 0, ticks: 12, ratchet: 2 });
  });

  it('a gated Figure ratchet', () => {
    const figure = {
      kind: 'figure' as const,
      ...DEFAULT_FIGURE_CONFIG,
      divisor: DIVISORS.eighth,
      cells: [figureNoteCell(0, { ratchet: 2 }), figureNoteCell(1)],
      length: 2,
    };
    const both = playBoth(figure, { regions: ONE_BAR });
    expectSameSound(both);
    expect(notesOf(both).some((note) => note.ratchet)).toBe(false);
    expect(summaryOf(both)).toMatchObject(EXACT);
  });

  it('a gated Basslead ratchet', () => {
    const bass = {
      kind: 'bass' as const,
      ...DEFAULT_BASS_CONFIG,
      pitchMode: 'fixed' as const,
      gate: 0.5,
      steps: [bassNote({ ratchet: 2 }), bassNote({ octave: 1 })],
      length: 2,
    };
    const both = playBoth(bass, { regions: ONE_BAR });
    expectSameSound(both);
    expect(notesOf(both).some((note) => note.ratchet)).toBe(false);
  });

  it('a ratchet too short for the Roll (×2 over 2 ticks) keeps its two hits', () => {
    const steps = [gridNote(0, { ratchet: 2 }), REST];
    const both = playBoth(gridSpec(steps, { divisor: 2 }), { regions: ONE_BAR });
    expectSameSound(both);
    expect(notesOf(both).slice(0, 2)).toEqual([
      { tick: 0, ticks: 1, pitch: 33 },
      { tick: 1, ticks: 1, pitch: 33 },
    ]);
  });
});

describe('a Euclid part follows the same rules', () => {
  /** Hits on steps 1, 5, 9 and 13 at 1/16, ratcheted ×2, the first accented. */
  const euclid = (holdTicks: number): EuclideanSpec => ({
    kind: 'euclidean',
    ...DEFAULT_EUCLIDEAN_CONFIG,
    note: 36,
    hold: holdTicks * SPT,
    pattern: Array.from({ length: 16 }, (_, i) => i % 4 === 0),
    ratchets: Array.from({ length: 16 }, () => 2),
    accentLane: [true, false, false, false],
    accentVelocity: 0.4,
    accentMod: 0.25,
  });

  it('a hold that covers the spacing: each ratchet one note ×2, its accents written', () => {
    const both = playBoth(euclid(6), { preset: 'kick', regions: ONE_BAR });
    expectSameSound(both);
    const roll = both.part.regions[0]!.pattern as RollSpec;
    expect(roll.notes[0]).toEqual({ tick: 0, ticks: 6, pitch: 36, accent: true, ratchet: 2 });
    expect(roll).toMatchObject({ accentVelocity: 0.4, accentMod: 0.25 });
    expect(summaryOf(both)).toMatchObject({ ...EXACT, velocity: 0.8 });
  });

  it('a hold shorter than the spacing keeps its hits, still accented', () => {
    const both = playBoth(euclid(2), { preset: 'kick', regions: ONE_BAR });
    expectSameSound(both);
    expect(notesOf(both).slice(0, 2)).toEqual([
      { tick: 0, ticks: 2, pitch: 36, accent: true },
      { tick: 3, ticks: 2, pitch: 36, accent: true },
    ]);
  });
});
