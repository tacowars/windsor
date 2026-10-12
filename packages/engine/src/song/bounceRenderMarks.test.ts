/**
 * Bounce to Roll's accents and ratchets where the normaliser's rules or a
 * roll's single pair of accent amounts stop them being written (windsor#755,
 * record `2026-10-12-roll-note-accent-and-ratchet` decisions 5 and 11):
 * accents that differ within a region, and accents and ratchets on an
 * onset another note shares. No generator plays these in one region, so
 * the writer is handed the played notes directly. Then the region-wide
 * rules through whole bounces: each region's roll takes its own amounts,
 * and a Chord part's shared onsets carry neither mark.
 */
import { describe, expect, it } from 'vitest';

import { expectSameSound, playBoth } from '../__fixtures__/bounceParity';
import { BOUNCE_SLOT, gridNote, gridSpec } from '../__fixtures__/bounceRig';
import { applyBounce, bounceDocument } from '../__fixtures__/bounceToRollRig';
import type { ChordSpec, RollSpec } from './arrangement';
import { bounceCounts } from './bounceRender';
import { settleAccents } from './bounceRenderAccents';
import { writeNotes, type NoteFrame } from './bounceRenderNotes';
import type { PlayedNote } from './bounceRenderTypes';
import { bounceToRoll } from './bounceToRoll';
import { DEFAULT_CHORD_CONFIG, hitStep } from '../sequencing/chordSequencer';
import { meterBeats } from '../sequencing/meter';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';

const clock = new TickTransport();
const FRAME: NoteFrame = {
  start: 0,
  duration: TICKS_PER_BAR,
  mono: false,
  clock,
  ratchetClock: { secondsPerTick: clock.secondsPerTick, swing: clock.swing, beats: meterBeats() },
};
const PLAIN = 0.8;
const ACCENT = { velocity: 0.2, mod: 1 };

/** A note played on `on` until `off` (straight ticks), at the part's 0.8, plus an accent's bump. */
function played(on: number, off: number, over: Partial<PlayedNote> = {}): PlayedNote {
  const accent = over.accent;
  return {
    pitch: 60,
    on,
    off,
    velocity: accent ? Math.min(1, PLAIN + accent.velocity) : PLAIN,
    plain: PLAIN,
    own: 1,
    accent,
    slide: false,
    stepMod: undefined,
    roll: null,
    ...over,
  };
}

const settled = (notes: readonly PlayedNote[]) => settleAccents(writeNotes(notes, FRAME));

describe('accents a roll cannot play', () => {
  it('a region whose accents differ bakes every bump into its velocity and counts each lost mod', () => {
    const { notes, accent } = settled([
      played(0, 6, { accent: ACCENT }),
      played(6, 12, { accent: { velocity: 0.1, mod: 0 } }),
      played(12, 18),
    ]);
    expect(accent).toBeNull();
    expect(notes.map((note) => note.accent)).toEqual([undefined, undefined, undefined]);
    expect(notes.map((note) => note.velocity)).toEqual([1, 0.9, PLAIN]);
    // A mod of 0 loses nothing.
    expect(notes.map((note) => note.marks.accentMod)).toEqual([true, false, false]);
    expect(bounceCounts(notes).accentsLostMod).toBe(1);
  });

  it('an accent on a shared onset is baked; the region’s others are written', () => {
    const { notes, accent } = settled([
      played(0, 6, { accent: ACCENT }),
      played(0, 6, { pitch: 64, accent: ACCENT }),
      played(6, 12, { accent: ACCENT }),
    ]);
    expect(accent).toEqual(ACCENT);
    expect(notes.map((note) => [note.tick, note.accent, note.velocity])).toEqual([
      [0, undefined, 1],
      [0, undefined, 1],
      [6, true, PLAIN],
    ]);
    expect(bounceCounts(notes).accentsLostMod).toBe(2);
  });
});

describe('a ratchet a roll cannot play', () => {
  /** A ×2 at 1/16, gate 1, last hit open to 6. */
  const ratchet = (pitch = 60): PlayedNote[] => [
    played(0, 3, { pitch, roll: pitch }),
    played(3, 6, { pitch, roll: pitch }),
  ];

  it('alone, it is one note ×2', () => {
    expect(settled(ratchet()).notes).toMatchObject([{ tick: 0, ticks: 6, ratchet: 2 }]);
  });

  it('on an onset another note shares, it keeps its hits', () => {
    const { notes } = settled([...ratchet(), played(0, 6, { pitch: 64 })]);
    expect(notes.map(({ tick, ticks, pitch, ratchet: r }) => [tick, ticks, pitch, r])).toEqual([
      [0, 3, 60, undefined],
      [0, 6, 64, undefined],
      [3, 3, 60, undefined],
    ]);
  });

  it('two chord tones ratcheted together both keep their hits', () => {
    const { notes } = settled([...ratchet(60), ...ratchet(64)]);
    expect(notes).toHaveLength(4);
    expect(notes.some((note) => note.ratchet)).toBe(false);
  });
});

describe('the region-wide rules through whole bounces', () => {
  const twoRegions = [
    {
      start: 0,
      duration: TICKS_PER_BAR,
      pattern: gridSpec([gridNote(0, { accent: true }), gridNote(2)], {
        accentVelocity: 0.5,
        accentMod: 0.25,
      }),
    },
    { start: 2 * TICKS_PER_BAR, duration: TICKS_PER_BAR },
  ];
  const grid = gridSpec([gridNote(0), gridNote(4, { accent: true })]);

  it('each region’s roll takes the amounts its own accents play, and the Vel is kept', () => {
    const doc = bounceDocument(grid, { regions: twoRegions });
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    const { normalised } = applyBounce(doc, result);
    expect(normalised.corrections).toEqual([]);
    const part = normalised.document.parts[0]!;
    const [first, second] = part.regions.map((region) => region.pattern as RollSpec);
    expect(first).toMatchObject({ accentVelocity: 0.5, accentMod: 0.25 });
    // The rig's Grid plays the defaults, 0.2 and 1: written as no key.
    expect(second?.accentVelocity).toBeUndefined();
    expect(second?.accentMod).toBeUndefined();
    expect(part.velocity).toBe(PLAIN);
    expect(result.ok && result.summary.accentsLostMod).toBe(0);
    for (const index of [0, 1]) {
      expectSameSound(playBoth(grid, { regions: twoRegions }, index));
    }
  });

  it('a Chord part bounces with no accent or ratchet on its shared onsets', () => {
    const chord: ChordSpec = { kind: 'chord', ...DEFAULT_CHORD_CONFIG, steps: [hitStep()] };
    const doc = bounceDocument(chord, { preset: 'drone-sqr' });
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    const { normalised } = applyBounce(doc, result);
    expect(normalised.corrections).toEqual([]);
    const roll = normalised.document.parts[0]!.regions[0]!.pattern as RollSpec;
    expect(roll.notes.filter((note) => note.tick === 0).length).toBeGreaterThan(1);
    expect(roll.notes.some((note) => note.accent || note.ratchet)).toBe(false);
    expectSameSound(playBoth(chord, { preset: 'drone-sqr' }));
  });
});
