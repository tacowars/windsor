/**
 * Bounce to Roll's render against the record's worked examples (windsor#740,
 * `docs/log/2026-10-11-bounce-to-roll.md`): the velocity table, the Acid
 * Saw bar and its slide over the bar line, and the Arp's skip take.
 */
import { describe, expect, it } from 'vitest';

import { bounceSong, gridNote, gridSpec, render, REST, span, TIE } from '../__fixtures__/bounceRig';
import type { ArpSpec, FigureSpec } from './arrangement';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { DEFAULT_FIGURE_CONFIG, figureNoteCell } from '../sequencing/figureSequencer';
import type { GridStep } from '../sequencing/gridSequencer';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

/**
 * The Acid Saw line of
 * `docs/research/2026-10-04-acid-ladder-filter/audition/acid-audition.song.json`:
 * 16 steps at 1/16 in A natural minor at register octave 1, skip chance 0.
 */
const ACID_SAW: readonly GridStep[] = [
  gridNote(0, { accent: true }),
  gridNote(0),
  gridNote(0, { octave: 1, slide: true }),
  TIE,
  gridNote(2),
  REST,
  gridNote(0, { accent: true }),
  gridNote(6, { slide: true }),
  gridNote(0),
  gridNote(0, { octave: 1, accent: true }),
  gridNote(3, { slide: true }),
  TIE,
  REST,
  gridNote(4, { accent: true }),
  gridNote(0, { slide: true }),
  gridNote(0, { octave: 1 }),
];

/** The record's table: each bar's twelve written notes as `[tick, end, pitch]`. */
const ACID_BAR = [
  [0, 6, 33],
  [6, 13, 33],
  [12, 24, 45],
  [24, 30, 36],
  [36, 43, 33],
  [42, 48, 43],
  [48, 54, 33],
  [54, 61, 45],
  [60, 72, 38],
  [78, 85, 40],
  [84, 90, 33],
  [90, 96, 45],
];
const ACCENTED_TICKS = [0, 36, 54, 78];

const acidSong = (steps = ACID_SAW) =>
  bounceSong(gridSpec(steps, { accentVelocity: 0.2, accentMod: 1 }), { preset: 'acid-saw' });

describe('the Acid Saw bar (decision 5’s first example)', () => {
  const { notes, counts } = render(acidSong());

  it('renders each of the four bars as the record’s twelve notes', () => {
    const bars = [0, 1, 2, 3].flatMap((bar) =>
      ACID_BAR.map(([tick, end, pitch]) => [
        tick! + bar * TICKS_PER_BAR,
        end! + bar * TICKS_PER_BAR,
        pitch!,
      ]),
    );
    expect(notes.map(span)).toEqual(bars);
  });

  it('plays the eight plain notes at the part’s 0.8 and the four accents at 1, each losing its mod', () => {
    for (const note of notes.slice(0, ACID_BAR.length)) {
      const accented = ACCENTED_TICKS.includes(note.tick);
      expect(note.velocity).toBe(accented ? 1 : 0.8);
      expect(note.marks.accentMod).toBe(accented);
    }
    expect(counts).toMatchObject({
      notes: 48,
      accentsLostMod: 16,
      ticksRounded: 0,
      ratchetHitsLost: 0,
      repeatsTrimmed: 0,
      euclidTailsCut: 0,
    });
  });

  it('with a slide on step 1, each later bar’s step-16 A2 runs one tick across the bar line', () => {
    const slid = render(
      acidSong([gridNote(0, { accent: true, slide: true }), ...ACID_SAW.slice(1)]),
    );
    const a2s = slid.notes.filter((note) => note.pitch === 45 && note.tick % TICKS_PER_BAR === 90);
    // Bar 1's step 1 has nothing held to slide from; bars 2–4 slide from the A2 before them.
    expect(a2s.map(span)).toEqual([
      [90, 97, 45],
      [186, 193, 45],
      [282, 289, 45],
      [378, 384, 45],
    ]);
  });
});

describe('the velocity table (decision 4)', () => {
  it('a Grid at Vel 0.8 with a bump of 0.3 plays 0.8 plain and 1.0 accented', () => {
    const song = bounceSong(
      gridSpec([gridNote(0), gridNote(0, { accent: true })], { accentVelocity: 0.3 }),
    );
    const [plain, accented] = render(song).notes;
    expect(plain?.velocity).toBe(0.8);
    expect(accented?.velocity).toBe(1);
    // Rescaled by the highest level, 1.0, both are given back exactly.
    expect(1 * (plain!.velocity / 1)).toBe(0.8);
  });

  it('at Vel 0.5 an accent plays 0.8, and the plain note written 0.5 ÷ 0.8 plays back 0.5', () => {
    const steps = [gridNote(0), gridNote(0, { accent: true })];
    const song = bounceSong(gridSpec(steps, { accentVelocity: 0.3 }), { velocity: 0.5 });
    const [plain, accented] = render(song).notes;
    expect(accented?.velocity).toBe(0.8);
    expect(plain!.velocity / accented!.velocity).toBe(0.625);
    expect(accented!.velocity * (plain!.velocity / accented!.velocity)).toBe(0.5);
  });

  it('a Figure cell at 0.5 under Vel 0.8, accented, plays 0.7, which 0.8 × (0.7 ÷ 0.8) gives back', () => {
    const figure: FigureSpec = {
      kind: 'figure',
      ...DEFAULT_FIGURE_CONFIG,
      cells: [figureNoteCell(0, { velocity: 0.5, accent: true })],
      length: 1,
      accentVelocity: 0.3,
    };
    const [note] = render(bounceSong(figure)).notes;
    expect(note?.velocity).toBe(0.7);
    expect(note?.own).toBe(0.5);
    expect(note!.velocity / 0.8).toBe(0.8749999999999999);
    expect(0.8 * (note!.velocity / 0.8)).toBe(0.7);
  });
});

describe('the Arp that never repeats (decision 5’s second example)', () => {
  it('skips the record’s fifteen onsets of 64 and plays the 49 others', () => {
    const arp: ArpSpec = { kind: 'arp', ...DEFAULT_ARP_CONFIG, skipChance: 0.25, seed: 0 };
    const { notes } = render(bounceSong(arp));
    expect(notes).toHaveLength(49);
    const onsets = new Set(notes.map((note) => note.tick));
    const bars = [0, 1, 2, 3].map((bar) =>
      Array.from({ length: 16 }, (_, i) =>
        onsets.has(bar * TICKS_PER_BAR + i * 6) ? '.' : 'x',
      ).join(''),
    );
    expect(bars.join('   ')).toBe(
      'xx..........x...   x....x......x...   .....x...xx.x.xx   .......x....x.x.',
    );
  });
});
