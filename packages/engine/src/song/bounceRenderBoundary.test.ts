/**
 * Bounce to Roll's render at the record's boundary cases (windsor#740,
 * `docs/log/2026-10-11-bounce-to-roll.md`): a part Vel of 0, an all-rest
 * region, a slide on the region's last step, chords on one tick, the
 * overlap rules on a mono and a poly patch, the sequencer lanes read, and
 * what the render refuses.
 */
import { describe, expect, it } from 'vitest';

import {
  BOUNCE_SLOT,
  bounceSong,
  gridNote,
  gridSpec,
  playRegion,
  render,
  REST,
  span,
} from '../__fixtures__/bounceRig';
import type { AutomationLane } from '../automation/automationLane';
import type { ChordSpec, EuclideanSpec, FigureSpec, RollSpec } from './arrangement';
import { renderBounceRegion } from './bounceRender';
import { PRESETS } from '../patch/presets';
import { DEFAULT_CHORD_CONFIG, hitStep } from '../sequencing/chordSequencer';
import { DEFAULT_EUCLIDEAN_CONFIG } from '../sequencing/euclideanSequencer';
import { DEFAULT_FIGURE_CONFIG, figureNoteCell } from '../sequencing/figureSequencer';
import { DEFAULT_ROLL_CONFIG } from '../sequencing/rollSequencer';

const ONE_BAR = [{ start: 0, duration: 96 }];
const SPT = 60 / 120 / 24;

describe('a part Vel of 0', () => {
  it('plays every plain note at 0, each keeping its event’s own velocity for the bounce to write', () => {
    const figure: FigureSpec = {
      kind: 'figure',
      ...DEFAULT_FIGURE_CONFIG,
      cells: [figureNoteCell(0, { velocity: 0.6 }), figureNoteCell(1)],
      length: 2,
    };
    const { notes, counts } = render(bounceSong(figure, { velocity: 0, regions: ONE_BAR }));
    expect(notes).toHaveLength(16);
    expect(notes.every((note) => note.velocity === 0)).toBe(true);
    expect(notes.map((note) => note.own).slice(0, 2)).toEqual([0.6, 1]);
    expect(counts.zeroVelocity).toBe(16);
  });

  it('with accents, an accented note is written at 0 to play the roll’s bump, and a plain one 0', () => {
    const grid = gridSpec([gridNote(0, { accent: true }), gridNote(0)], { accentVelocity: 0.3 });
    const { notes, counts, accent } = render(bounceSong(grid, { velocity: 0, regions: ONE_BAR }));
    expect(notes.slice(0, 2).map((note) => note.velocity)).toEqual([0, 0]);
    expect(notes[0]?.accent).toBe(true);
    expect(accent?.velocity).toBe(0.3);
    // Only the plain notes played at 0: the accents played the bump.
    expect(counts.zeroVelocity).toBe(8);
  });
});

describe('a region that is all rests', () => {
  it('renders no notes, no envelopes and no counts, its rests written or varied', () => {
    const varied = { randomness: 1, probability: 1, restsSound: true };
    for (const grid of [gridSpec([REST, REST]), gridSpec([REST, REST], varied)]) {
      const { notes, envelopes, counts } = render(bounceSong(grid));
      expect(notes).toEqual([]);
      expect(envelopes).toEqual([]);
      expect(counts).toEqual({
        notes: 0,
        ticksRounded: 0,
        ratchetHitsLost: 0,
        accentsLostMod: 0,
        repeatsTrimmed: 0,
        euclidTailsCut: 0,
        zeroVelocity: 0,
      });
    }
  });
});

describe('a slide on the region’s last step', () => {
  it('lengthens the note slid from to the slid-to onset + 1, and the slid-to note runs to the end', () => {
    const steps = [
      ...Array.from({ length: 14 }, () => REST),
      gridNote(0),
      gridNote(2, { slide: true }),
    ];
    const { notes } = render(bounceSong(gridSpec(steps), { regions: ONE_BAR, preset: 'acid-saw' }));
    expect(notes.map(span)).toEqual([
      [84, 91, 33],
      [90, 96, 36],
    ]);
  });
});

describe('notes on one tick', () => {
  it('a Chord part’s chord is written as it is, on a mono patch too: nothing that starts together slides', () => {
    const chord: ChordSpec = {
      kind: 'chord',
      ...DEFAULT_CHORD_CONFIG,
      divisor: 48,
      steps: [hitStep()],
    };
    for (const preset of ['drone-sqr', 'acid-saw']) {
      const { notes } = render(bounceSong(chord, { regions: ONE_BAR, preset }));
      const first = notes.filter((note) => note.tick === 0);
      expect(first.length).toBeGreaterThan(1);
      expect(new Set(first.map((note) => note.ticks)).size).toBe(1);
    }
  });
});

describe('overlaps that did not slide', () => {
  /** Hits on steps 1 and 3, held 18 ticks, the second a fifth up: held across the second onset. */
  const euclid: EuclideanSpec = {
    kind: 'euclidean',
    ...DEFAULT_EUCLIDEAN_CONFIG,
    note: 36,
    hold: 18 * SPT,
    pattern: Array.from({ length: 16 }, (_, i) => i === 0 || i === 2),
    pitchLane: [0, 0, 7],
  };

  it('on a mono patch the held note is trimmed at the other pitch’s onset, where the engine cut it', () => {
    const { notes, counts } = render(bounceSong(euclid, { regions: ONE_BAR, preset: 'acid-saw' }));
    expect(notes.map(span)).toEqual([
      [0, 12, 36],
      [12, 30, 43],
    ]);
    expect(counts.repeatsTrimmed).toBe(0);
  });

  it('on a poly patch both sounded, and both are kept', () => {
    const { notes } = render(bounceSong(euclid, { regions: ONE_BAR, preset: 'kick' }));
    expect(notes.map(span)).toEqual([
      [0, 18, 36],
      [12, 30, 43],
    ]);
  });

  it('a note held into its own pitch’s onset is trimmed there and counted, on any patch', () => {
    const same = { ...euclid, pitchLane: [0] };
    const { notes, counts } = render(bounceSong(same, { regions: ONE_BAR, preset: 'kick' }));
    expect(notes.map(span)).toEqual([
      [0, 12, 36],
      [12, 30, 36],
    ]);
    expect(notes[0]?.marks.trimmed).toBe(true);
    expect(counts.repeatsTrimmed).toBe(1);
  });
});

describe('the part’s sequencer lanes', () => {
  const probabilityLane: AutomationLane = {
    target: 'seq.probability',
    on: true,
    points: [
      { tick: 0, value: 0, bend: 0 },
      { tick: 192, value: 1, bend: 0 },
    ],
  };

  it('are read as the gate reads them, so the render rests where the player did, and are named', () => {
    const steps = [gridNote(0), gridNote(2), gridNote(4), gridNote(2)];
    const grid = gridSpec(steps, { seed: 4, randomness: 1, restsSound: true });
    const song = bounceSong(grid, { automation: [probabilityLane] });
    const { notes, seqLanes } = render(song);
    const onsets = playRegion(song).calls.filter((call) => call.kind === 'noteOn');
    expect(notes.map((note) => note.tick)).toEqual(
      onsets.map((call) => Math.round(call.time! / SPT)),
    );
    expect(notes.length).toBeLessThan(64);
    expect(seqLanes).toEqual(['probability']);
  });

  it('a part with none reads none', () => {
    expect(render(bounceSong(gridSpec([gridNote(0)]))).seqLanes).toEqual([]);
  });
});

describe('what the render refuses', () => {
  it('a Roll part, a slot the song lacks and a region it lacks', () => {
    const roll: RollSpec = { kind: 'roll', ...DEFAULT_ROLL_CONFIG };
    expect(() => render(bounceSong(roll))).toThrow(/does not bounce/);
    const song = bounceSong(gridSpec([gridNote(0)]));
    expect(() => renderBounceRegion(song, PRESETS, BOUNCE_SLOT + 1, 0)).toThrow(/no part/);
    expect(() => render(song, 1)).toThrow(/no region 1/);
  });
});
