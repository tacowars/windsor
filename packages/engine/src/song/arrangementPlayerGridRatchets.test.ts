/**
 * A Grid step's ratchet through the player (windsor#366, record
 * `2026-10-01-sequencer-rack-devices` decision 6): a roll of N hits of the
 * step's note evenly across its span, each but the first after the previous
 * hit's note-off; a slide into hit 0 only; the accent and offsets on every
 * hit; the last hit held through a tie and released by a rest; one skip draw
 * per step; and the hits past a region end or a loop jump dropped.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_PARTS, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { Arrangement, GridSpec, PartRegion, Transport } from './arrangement';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { gridNote, type GridStep } from '../sequencing/gridSequencer';
import { DIVISORS, PPQ } from '../sequencing/scheduler';
import { VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';

const BPM = 120;
const TICK = SECONDS_PER_MINUTE / BPM / PPQ;
const SIXTEENTH = DIVISORS.sixteenth;
const SPAN = SIXTEENTH * TICK;
const REST: GridStep = { kind: 'rest' };
const TIE: GridStep = { kind: 'tie' };
/** D dorian at register octave 4: degree 0 is D4, degree 2 is F4. */
const D4 = 62;
const F4 = 65;
const VELOCITY = FULL_PARTS.arp.velocity;

interface GridSong {
  readonly grid?: Partial<GridSpec>;
  readonly regions?: readonly PartRegion[];
  readonly transport?: Partial<Transport>;
}

/** The fixture song at 120 bpm, its grid line on `steps`, nothing skipped unless asked. */
function song(steps: readonly GridStep[], over: GridSong = {}): Arrangement {
  const sequencer: GridSpec = {
    ...FULL_PARTS.arp.sequencer,
    divisor: SIXTEENTH,
    steps,
    length: steps.length,
    skipChance: 0,
    ...over.grid,
  };
  const base = {
    ...FULL_ARRANGEMENT,
    transport: { ...FULL_ARRANGEMENT.transport, bpm: BPM, ...over.transport },
  };
  return withPart(base, 'arp', { sequencer, ...(over.regions ? { regions: over.regions } : {}) });
}

function play(arrangement: Arrangement, bars = 1): Call[] {
  const r = rig(arrangement);
  r.run(bars);
  return r.parts.arp.calls;
}

/** A call as `[kind, note, start tick, held ticks]`, ticks rounded to a thousandth. */
const at = (c: Call): [string, number | undefined, number, number | undefined] => [
  c.kind,
  c.note,
  Math.round(((c.time ?? 0) / TICK) * 1000) / 1000,
  c.duration === undefined ? undefined : Math.round((c.duration / TICK) * 1000) / 1000,
];

/** Whether a call starts inside step `k`'s straight span. */
const inStep =
  (k: number) =>
  (c: Call): boolean =>
    Math.floor((c.time ?? 0) / SPAN + 1e-9) === k;

const sounding = (calls: readonly Call[]): Call[] =>
  calls.filter((c) => c.kind === 'noteOn' || c.kind === 'trigger');

describe('Grid ratchets through the player (windsor#366)', () => {
  it('×3 at 1/16 and 120 bpm: three hits at the step, +⅓ and +⅔, each after the last one’s off', () => {
    const calls = play(song([gridNote(0, { ratchet: 3 }), REST, REST, REST]));
    const roll = calls.filter(inStep(0));
    expect(roll.map(at)).toEqual([
      ['trigger', D4, 0, 2],
      ['trigger', D4, 2, 2],
      ['noteOn', D4, 4, undefined],
    ]);
    roll.forEach((hit, j) => expect(hit.time).toBeCloseTo((j * SPAN) / 3, 12));
    // Each closed hit's note-off lands on the next hit's start, and is sent before it.
    for (let j = 0; j < 2; j++) {
      expect((roll[j]!.time ?? 0) + (roll[j]!.duration ?? 0)).toBeCloseTo(roll[j + 1]!.time!, 12);
    }
    // The rest on the next step releases the last hit, as it would a plain note.
    expect(at(calls[3]!)).toEqual(['noteOffByNote', D4, SIXTEENTH, undefined]);
  });

  it('a slide slides into hit 0 only; the later hits retrigger without it', () => {
    const calls = play(song([gridNote(0), gridNote(2, { slide: true, ratchet: 3 }), REST, REST]));
    const step = calls.filter(inStep(1));
    expect(step.map(at)).toEqual([
      ['trigger', F4, SIXTEENTH, 2],
      ['trigger', F4, SIXTEENTH + 2, 2],
      ['noteOn', F4, SIXTEENTH + 4, undefined],
      // The held D4 lets go after the slide took its voice, as a plain slide's does.
      ['noteOffByNote', D4, SIXTEENTH, undefined],
    ]);
    expect(step[0]?.extras).toEqual({ mod: 0, slide: true });
    expect(step[1]).not.toHaveProperty('extras');
    expect(step[2]).not.toHaveProperty('extras');
  });

  it('the accent and the step’s offsets ride on every hit', () => {
    const lanes = [{ param: 'filter.cutoff' as const, values: [0.5, 0] }];
    const grid = { lanes, accentVelocity: 0.2, accentMod: 0.5 };
    const calls = play(song([gridNote(0, { accent: true, ratchet: 4 }), REST], { grid }));
    const stepMod = new Array<number>(VOICE_TARGET_PATHS.length).fill(0);
    stepMod[VOICE_TARGET_PATHS.indexOf('filter.cutoff')] = 0.5;
    const roll = sounding(calls).filter(inStep(0));
    expect(roll).toHaveLength(4);
    for (const hit of roll) {
      expect(hit).toMatchObject({
        velocity: VELOCITY + 0.2,
        extras: { mod: 0.5, slide: false, stepMod },
      });
    }
  });

  it('a tie holds the last hit; the rest after it releases it', () => {
    const calls = play(song([gridNote(0, { ratchet: 2 }), TIE, REST, REST]));
    expect(calls.slice(0, 3).map(at)).toEqual([
      ['trigger', D4, 0, 3],
      ['noteOn', D4, 3, undefined],
      ['noteOffByNote', D4, 2 * SIXTEENTH, undefined],
    ]);
  });

  it('skips the same steps with and without ratchets, and a skipped step plays no hit', () => {
    const plain = Array.from({ length: 16 }, (_, i) => gridNote(i % 5));
    const ratcheted = plain.map((step, i) => ({ ...step, ratchet: 2 + (i % 3) }));
    const startsOf = (calls: readonly Call[]): number[] => [
      ...new Set(sounding(calls).map((c) => Math.floor((c.time ?? 0) / SPAN + 1e-9))),
    ];
    const hitsIn = (calls: readonly Call[], step: number): Call[] =>
      sounding(calls).filter(inStep(step));
    const grid = { skipChance: 0.5 };
    const without = play(song(plain, { grid }), 4);
    const withRatchets = play(song(ratcheted, { grid }), 4);
    const steps = startsOf(without);
    expect(steps.length).toBeGreaterThan(16);
    expect(steps.length).toBeLessThan(48);
    expect(startsOf(withRatchets)).toEqual(steps);
    // Every sounding step rolls its whole ratchet; the skipped ones play nothing.
    for (const step of steps) {
      expect(hitsIn(withRatchets, step), `step ${step}`).toHaveLength(2 + ((step % 16) % 3));
    }
  });

  it('a region end inside a roll drops the hits past it, and the last hit held is released there', () => {
    const regions = [{ start: 0, duration: SIXTEENTH + 3 }];
    const calls = play(song([gridNote(0, { ratchet: 4 })], { regions }));
    expect(calls.map(at)).toEqual([
      ['trigger', D4, 0, 1.5],
      ['trigger', D4, 1.5, 1.5],
      ['trigger', D4, 3, 1.5],
      ['noteOn', D4, 4.5, undefined],
      ['noteOffByNote', D4, 6, undefined],
      ['trigger', D4, 6, 1.5],
      ['noteOn', D4, 7.5, undefined],
      ['noteOffByNote', D4, 9, undefined],
    ]);
  });

  it('a loop jump inside a roll drops the hits past it', () => {
    // Steps at ticks 0 and 32; the loop's end at 48 cuts the second step's roll after two hits.
    const loop = { start: 0, end: 48, on: true };
    const grid = { divisor: 32 };
    const calls = play(song([gridNote(0, { ratchet: 4 })], { grid, transport: { loop } }));
    expect(calls.slice(0, 8).map(at)).toEqual([
      ['trigger', D4, 0, 8],
      ['trigger', D4, 8, 8],
      ['trigger', D4, 16, 8],
      ['noteOn', D4, 24, undefined],
      ['noteOffByNote', D4, 32, undefined],
      ['trigger', D4, 32, 8],
      ['noteOn', D4, 40, undefined],
      // The jump releases the last hit; the loop's start rolls step 0 afresh.
      ['noteOffByNote', D4, 48, undefined],
    ]);
    expect(at(calls[8]!)).toEqual(['trigger', D4, 48, 8]);
  });
});
