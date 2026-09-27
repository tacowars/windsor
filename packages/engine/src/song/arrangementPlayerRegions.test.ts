/**
 * Regions and the harmony timeline through the player (#705): a Chord
 * Player's hits follow the timeline, a hit sustains across a chord boundary,
 * a grid's position is its region's local count, a region end releases what
 * a part holds, and the same document at the same tick after ■ / ▶ (a fresh
 * player at tick 0) plays the same notes — epic #703 decisions 2, 5, 15, 16.
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_PARTS,
  FULL_REGION,
  FULL_SLOT,
  withPart,
} from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { kinds, type RecordingPart } from '../__fixtures__/recordingPart';
import type { Arrangement, GridSpec, Harmony, Region } from './arrangement';
import { hitStep, type ChordStep } from '../sequencing/chordSequencer';
import { gridNote, type GridStep } from '../sequencing/gridSequencer';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const SONG = 4 * BAR;
/** C natural minor: i for bar 1, VI from bar 2 on. */
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: BAR, degree: 0, size: 3 },
    { start: BAR, duration: 3 * BAR, degree: 5, size: 3 },
  ],
};
const BASE: Arrangement = { ...FULL_ARRANGEMENT, harmony: HARMONY };
const c2 = new ScaleSampler(HARMONY).rootNote(FULL_PARTS.drone.sequencer.register.octave);
const C_MINOR = [c2, c2 + 3, c2 + 7];
const A_FLAT = [c2 + 8, c2 + 12, c2 + 15];

const drone = (steps: ChordStep[], regions: Region[] = [FULL_REGION]): Arrangement =>
  withPart(BASE, 'drone', { regions, sequencer: { ...FULL_PARTS.drone.sequencer, steps } });
const grid = (over: Partial<GridSpec>, regions: Region[] = [FULL_REGION]): Arrangement =>
  withPart(BASE, 'arp', { regions, sequencer: { ...FULL_PARTS.arp.sequencer, ...over } });

/** A recording part's call time back to the tick it was issued on, at the song's tempo. */
const tickOf = (time: number, arrangement: Arrangement): number =>
  Math.round((time * arrangement.transport.bpm * PPQ) / SECONDS_PER_MINUTE);
const notesAt = (
  part: RecordingPart,
  kind: 'noteOn' | 'noteOffByNote',
  tick: number,
  a: Arrangement,
) =>
  kinds(part, kind)
    .filter((c) => tickOf(c.time ?? 0, a) === tick)
    .map((c) => c.note);

describe('the Chord Player over the harmony timeline', () => {
  it('a hit at bar 1 over i sounds Cm and the same step list at bar 2 over VI sounds A♭', () => {
    const arrangement = drone([hitStep()]);
    const r = rig(arrangement);
    r.run(2);
    expect(notesAt(r.parts.drone, 'noteOn', 0, arrangement)).toEqual(C_MINOR);
    expect(notesAt(r.parts.drone, 'noteOffByNote', BAR, arrangement)).toEqual(C_MINOR);
    expect(notesAt(r.parts.drone, 'noteOn', BAR, arrangement)).toEqual(A_FLAT);
  });

  it('a hit whose duration crosses the boundary keeps its Cm notes until its own end', () => {
    const arrangement = drone([hitStep({ duration: 2 })]);
    const r = rig(arrangement);
    r.run(3);
    expect(notesAt(r.parts.drone, 'noteOn', 0, arrangement)).toEqual(C_MINOR);
    expect(notesAt(r.parts.drone, 'noteOn', BAR, arrangement)).toEqual([]);
    expect(notesAt(r.parts.drone, 'noteOffByNote', BAR, arrangement)).toEqual([]);
    expect(notesAt(r.parts.drone, 'noteOffByNote', 2 * BAR, arrangement)).toEqual(C_MINOR);
    expect(notesAt(r.parts.drone, 'noteOn', 2 * BAR, arrangement)).toEqual(A_FLAT);
  });
});

describe('a grid’s position through its regions', () => {
  const seven: GridStep[] = [0, 1, 2, 3, 4, 5, 6].map((d) => gridNote(d));
  const sixteenth = 6;

  it('a 7-step grid at 1/16 in one ∞ region over a 4-bar song is at step (384 / 6) mod 7 = 1 at tick 384', () => {
    const r = rig(grid({ divisor: sixteenth, steps: seven, length: 7 }));
    expect(r.player.stepAt(FULL_SLOT.arp, SONG)).toBe((SONG / sixteenth) % 7);
    expect((SONG / sixteenth) % 7).not.toBe(0);
  });

  it('the same grid split into two regions at bar 3 is at step 0 at tick 192, and -1 in a gap', () => {
    const halves: Region[] = [
      { start: 0, duration: 2 * BAR },
      { start: 2 * BAR, duration: 2 * BAR },
    ];
    const r = rig(grid({ divisor: sixteenth, steps: seven, length: 7 }, halves));
    expect(r.player.stepAt(FULL_SLOT.arp, 2 * BAR)).toBe(0);
    expect(r.player.stepAt(FULL_SLOT.arp, 2 * BAR - sixteenth)).toBe(
      ((2 * BAR) / sixteenth - 1) % 7,
    );
    const gapped = rig(grid({ divisor: sixteenth, steps: seven, length: 7 }, [halves[0]!]));
    expect(gapped.player.stepAt(FULL_SLOT.arp, 3 * BAR)).toBe(-1);
    expect(gapped.player.stepAt(FULL_SLOT.arp, SONG)).toBe(0);
  });
});

describe('a region end releases what the part holds', () => {
  const firstBar: Region[] = [{ start: 0, duration: BAR }];

  it('a grid tie running into the region end produces a note-off on that tick', () => {
    const quarter = PPQ;
    const held: GridStep[] = [gridNote(0), { kind: 'tie' }, { kind: 'tie' }, { kind: 'tie' }];
    const arrangement = grid({ divisor: quarter, steps: held, length: 4, skipChance: 0 }, firstBar);
    const r = rig(arrangement);
    r.run(2);
    const on = kinds(r.parts.arp, 'noteOn');
    expect(on).toHaveLength(1);
    expect(notesAt(r.parts.arp, 'noteOffByNote', BAR, arrangement)).toEqual([on[0]!.note]);
  });

  it('a chord hit likewise', () => {
    const arrangement = drone([hitStep({ duration: 2 })], firstBar);
    const r = rig(arrangement);
    r.run(2);
    expect(kinds(r.parts.drone, 'noteOn').map((c) => c.note)).toEqual(C_MINOR);
    expect(notesAt(r.parts.drone, 'noteOffByNote', BAR, arrangement)).toEqual(C_MINOR);
  });
});

describe('the determinism rule (■ then ▶ is a fresh player at tick 0)', () => {
  it('two players over the same document produce the same note sequence, skips included', () => {
    const arrangement = grid({ skipChance: 0.5, seed: 11 });
    const first = rig(arrangement);
    const second = rig(arrangement);
    first.run(2);
    second.run(2);
    const trace = (part: RecordingPart) =>
      part.calls.map((c) => `${c.kind} ${c.note ?? ''} @${tickOf(c.time ?? 0, arrangement)}`);
    expect(trace(second.parts.arp)).toEqual(trace(first.parts.arp));
    expect(trace(second.parts.drone)).toEqual(trace(first.parts.drone));
    // The stream did something: not every written step sounded.
    const written = 2 * (BAR / FULL_PARTS.arp.sequencer.divisor);
    expect(kinds(first.parts.arp, 'noteOn').length).toBeLessThan(written);
    expect(kinds(first.parts.arp, 'noteOn').length).toBeGreaterThan(0);
  });

  it('reset() after releaseAll replays the same notes from tick 0 on the same player (#708)', () => {
    const arrangement = grid({ skipChance: 0.5, seed: 11 });
    const r = rig(arrangement);
    const trace = (part: RecordingPart, from: number) =>
      part.calls
        .slice(from)
        .filter((c) => c.kind === 'noteOn')
        .map((c) => `${c.note ?? ''} @${tickOf(c.time ?? 0, arrangement)}`);
    // Stop mid-song, off a bar line, so the streams have moved on.
    r.run(1);
    for (let i = 0; i < BAR / 2; i++) r.transport.advance(r.transport.transportSeconds);
    const firstRun = { arp: trace(r.parts.arp, 0), drone: trace(r.parts.drone, 0) };
    r.player.releaseAll();
    const marks = { arp: r.parts.arp.calls.length, drone: r.parts.drone.calls.length };
    r.transport.reset(0);
    r.player.reset();
    r.run(1);
    for (let i = 0; i < BAR / 2; i++) r.transport.advance(r.transport.transportSeconds);
    expect(trace(r.parts.arp, marks.arp)).toEqual(firstRun.arp);
    expect(trace(r.parts.drone, marks.drone)).toEqual(firstRun.drone);
    expect(firstRun.arp.length).toBeGreaterThan(0);
  });

  it('without reset() the same player does not replay: the stream carries on', () => {
    const arrangement = grid({ skipChance: 0.5, seed: 11 });
    const r = rig(arrangement);
    const ons = (from: number) =>
      r.parts.arp.calls
        .slice(from)
        .filter((c) => c.kind === 'noteOn')
        .map((c) => `${c.note ?? ''} @${tickOf(c.time ?? 0, arrangement)}`);
    r.run(2);
    const firstRun = ons(0);
    r.player.releaseAll();
    const mark = r.parts.arp.calls.length;
    r.transport.reset(0);
    r.run(2);
    expect(ons(mark)).not.toEqual(firstRun);
  });
});
