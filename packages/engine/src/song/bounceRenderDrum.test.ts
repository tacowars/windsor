/**
 * Bounce to Roll for a Drum part (windsor#958, records
 * `2026-10-11-bounce-to-roll` and `2026-10-24-drum-sequencer`): the Drum
 * bounces through the bounce's own capture, with nothing Drum-specific
 * added. A hit is a Roll note at its tick, `note + pitch`, held its gate,
 * at its played level ÷ the part's Vel with its accent flagged; a ratchet
 * under gate 1 is its hits; step variation is what the run plays; the
 * `seq.*` lanes are baked and removed; a step-mod lane is a clip envelope.
 * Each part is also played as generated and again bounced, and the two
 * must sound alike, hit for hit (`bounceParity.ts`).
 */
import { describe, expect, it } from 'vitest';

import { expectSameSound, playBoth, type BothPlays } from '../__fixtures__/bounceParity';
import { BOUNCE_SLOT, bounceSong, render, span } from '../__fixtures__/bounceRig';
import { applyBounce, bounceDocument } from '../__fixtures__/bounceToRollRig';
import type { AutomationLane } from '../automation/automationLane';
import type { DrumSpec, MusicPart, PartRegion, RollSpec, Transport } from './arrangement';
import { bounceToRoll } from './bounceToRoll';
import type { BounceSummary } from './bounceToRollTypes';
import { DEFAULT_DRUM_CONFIG } from '../sequencing/drumSequencer';
import { DRUM_REST, drumHit, type DrumStep } from '../sequencing/drumSteps';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
/** Seconds per straight tick at the rig's 120 bpm. */
const SPT = 60 / 120 / 24;
const ONE_BAR: PartRegion[] = [{ start: 0, duration: BAR }];
const SWUNG: Partial<Transport> = { swing: { amount: 60, grid: 16 } };
/** A poly drum patch, so no onset cuts another. */
const KICK = 'kick';

/** A Drum line of `steps` at 1/16 on note 60, gate 0.5, nothing varied. */
const drumSpec = (steps: readonly DrumStep[], over: Partial<DrumSpec> = {}): DrumSpec => ({
  kind: 'drum',
  ...DEFAULT_DRUM_CONFIG,
  steps,
  length: steps.length,
  ...over,
});

/** A sixteenth-note line of `length` steps, rests but `hit` on step `at`. */
const oneHit = (hit: DrumStep, at = 0, length = 4): DrumStep[] =>
  Array.from({ length }, (_, i) => (i === at ? hit : DRUM_REST));

const notesOf = ({ part }: BothPlays, region = 0) =>
  (part.regions[region]!.pattern as RollSpec).notes;

const summaryOf = ({ result }: BothPlays): BounceSummary => {
  if (!result.ok) throw new Error('refused');
  return result.summary;
};

describe('a Drum region bounces to its hits', () => {
  it('four on the floor at gate 0.5: four notes of half a sixteenth at the part’s Vel on note 60', () => {
    const both = playBoth(drumSpec(DEFAULT_DRUM_CONFIG.steps), { preset: KICK });
    expectSameSound(both);
    expect(both.part.velocity).toBe(0.8);
    expect(both.part.sequencer.kind).toBe('roll');
    const roll = both.part.regions[0]!.pattern as RollSpec;
    expect(roll.loopTicks).toBe(BAR);
    expect(roll.notes).toEqual([0, 24, 48, 72].map((tick) => ({ tick, ticks: 3, pitch: 60 })));
    expect(summaryOf(both)).toMatchObject({ notes: 4, regions: 1, ticksRounded: 0 });
  });

  it('a hit at velocity 0.3 and pitch +7 is note 67 at its played level; an accent is flagged with its bump', () => {
    const steps = [drumHit({ velocity: 0.3, pitch: 7 }), drumHit({ accent: true }), DRUM_REST];
    const spec = drumSpec(steps, { accentVelocity: 0.15, accentMod: 0.5 });
    const { notes } = render(bounceSong(spec, { preset: KICK, regions: ONE_BAR }));
    // Played at 0.3 × the part's 0.8; the accented hit at 0.8, its bump on top.
    expect(notes[0]).toMatchObject({ tick: 0, pitch: 67, own: 0.3 });
    expect(notes[0]!.velocity).toBeCloseTo(0.24, 12);
    expect(notes[1]).toMatchObject({ tick: 6, pitch: 60, velocity: 0.8, accent: true });
    const both = playBoth(spec, { preset: KICK, regions: ONE_BAR });
    expectSameSound(both);
    const roll = both.part.regions[0]!.pattern as RollSpec;
    expect(roll).toMatchObject({ accentVelocity: 0.15, accentMod: 0.5 });
    expect(roll.notes.slice(0, 2)).toEqual([
      { tick: 0, ticks: 3, pitch: 67, velocity: 0.3 },
      { tick: 6, ticks: 3, pitch: 60, accent: true },
    ]);
    expect(both.part.velocity).toBe(0.8);
  });
});

describe('a Drum ratchet', () => {
  for (const [name, transport] of [
    ['straight', {}],
    ['at 60% sixteenth swing', SWUNG],
  ] as const) {
    it(`of 3 at gate 0.5 is three notes across the step, ${name}, on and off the beat`, () => {
      for (const at of [0, 1]) {
        const spec = drumSpec(oneHit(drumHit({ ratchet: 3 }), at));
        const both = playBoth(spec, { preset: KICK, regions: ONE_BAR, transport });
        expectSameSound(both);
        const start = 6 * at;
        expect(notesOf(both).slice(0, 3).map(span)).toEqual([
          [start, start + 1, 60],
          [start + 2, start + 3, 60],
          [start + 4, start + 5, 60],
        ]);
        expect(notesOf(both).some((note) => note.ratchet)).toBe(false);
        expect(summaryOf(both)).toMatchObject({ ticksRounded: 0, ratchetHitsLost: 0 });
      }
    });
  }

  it('of 3 at gate 1 is played exactly by one note ×3, and written so', () => {
    const spec = drumSpec(oneHit(drumHit({ ratchet: 3 })), { gate: 1 });
    const both = playBoth(spec, { preset: KICK, regions: ONE_BAR, transport: SWUNG });
    expectSameSound(both);
    expect(notesOf(both)[0]).toEqual({ tick: 0, ticks: 6, pitch: 60, ratchet: 3 });
  });
});

describe('a varied Drum bounces to what the run plays', () => {
  /** Two regions; the second, bars 4–5, is the one held, so its stream is region 1's. */
  const REGIONS: PartRegion[] = [
    { start: 0, duration: 2 * BAR },
    { start: 3 * BAR, duration: 2 * BAR },
  ];
  const LINE: DrumStep[] = [
    drumHit({ accent: true }),
    DRUM_REST,
    drumHit({ velocity: 0.3, pitch: 5 }),
    drumHit(),
    drumHit({ pitch: -3 }),
    DRUM_REST,
    drumHit({ velocity: 0.6, pitch: 7 }),
    DRUM_REST,
  ];
  const varied = { randomness: 0.5, probability: 1, seed: 13 };
  const playVaried = (line: readonly DrumStep[], over: Partial<DrumSpec>): BothPlays =>
    playBoth(drumSpec(line, { ...varied, ...over }), { preset: KICK, regions: REGIONS }, 1);

  for (const [name, over] of [
    ['Octave off, Rests sound on', { restsSound: true }],
    ['Octave on, Per effect on', { octaveMode: true, chancePerEffect: true }],
  ] as const) {
    it(`Vary 0.5, Chance 1, ${name}: note for note as the player plays it`, () => {
      const both = playVaried(LINE, over);
      expectSameSound(both);
      // The run varied something: the bounce is not the written line.
      const plain = playBoth(drumSpec(LINE), { preset: KICK, regions: REGIONS }, 1);
      expect(both.generated).not.toEqual(plain.generated);
    });
  }

  it('a varied ratchet keeps every hit’s onset, pitch and level, its varied holds rounded to ticks and counted', () => {
    const line = LINE.map((step, i) => (i === 3 ? drumHit({ ratchet: 2 }) : step));
    const both = playVaried(line, { restsSound: true });
    const { generated, bounced } = both;
    expect(bounced).toHaveLength(generated.length);
    const halfTick = SPT / 2;
    generated.forEach((hit, i) => {
      const after = bounced[i]!;
      expect(after).toMatchObject({ note: hit.note, mod: hit.mod });
      expect(after.time).toBeCloseTo(hit.time, 9);
      expect(after.velocity).toBeCloseTo(hit.velocity, 9);
      expect(Math.abs(after.end - hit.end)).toBeLessThanOrEqual(halfTick);
    });
    expect(summaryOf(both).ticksRounded).toBeGreaterThan(0);
  });
});

describe('a Drum part’s lanes', () => {
  const gateLane: AutomationLane = {
    target: 'seq.gate',
    on: true,
    points: [{ tick: 0, value: 1, bend: 0 }],
  };

  it('a `seq.gate` lane changes the captured lengths and is gone from the bounced part', () => {
    const spec = drumSpec(DEFAULT_DRUM_CONFIG.steps);
    const over = { preset: KICK, automation: [gateLane] };
    const { notes, seqLanes } = render(bounceSong(spec, over));
    expect(seqLanes).toEqual(['gate']);
    expect(notes.slice(0, 4).map(span)).toEqual([0, 24, 48, 72].map((t) => [t, t + 6, 60]));
    const doc = bounceDocument(spec, over);
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    const { normalised } = applyBounce(doc, result);
    expect(normalised.corrections).toEqual([]);
    const part = normalised.document.parts.find((p) => p.slot === BOUNCE_SLOT) as MusicPart & {
      automation?: readonly AutomationLane[];
    };
    expect(part.automation ?? []).toEqual([]);
    expect(result.ok && result.summary.lanesBaked).toEqual(['gate']);
  });

  it('a step-mod lane becomes a clip envelope that changes at the hits', () => {
    const steps = [drumHit(), drumHit(), DRUM_REST, drumHit()];
    const lanes = [{ param: 'filter.cutoff' as const, values: [0.5, 0, 0.75, -0.25] }];
    const both = playBoth(drumSpec(steps, { lanes }), {
      preset: KICK,
      regions: [{ start: 0, duration: 24 }],
    });
    const roll = both.part.regions[0]!.pattern as RollSpec;
    expect(roll.envelopes).toHaveLength(1);
    expect(roll.envelopes?.[0]).toMatchObject({ target: 'filter.cutoff', on: true });
    // The rest on step 2 plays nothing, so its 0.75 never sounds: the hits' values, held onset to onset.
    const step = 1 / 64;
    expect(roll.envelopes?.[0]?.points).toEqual([
      { tick: 0, value: 0.5, bend: 0 },
      { tick: 6 - step, value: 0.5, bend: 0 },
      { tick: 6, value: 0, bend: 0 },
      { tick: 18 - step, value: 0, bend: 0 },
      { tick: 18, value: -0.25, bend: 0 },
    ]);
  });
});
