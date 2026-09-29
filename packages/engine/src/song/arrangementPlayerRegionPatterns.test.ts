/**
 * Each region plays its own pattern (windsor#74, epic windsor#70, record
 * `2026-09-29-each-region-plays-its-own-pattern`): the player builds a
 * generator per region from `regionPattern(part, i)`, the region entered is
 * the one heard, it switches exactly at the next region's start, a region
 * plays at its own divisor, and the playhead reads the live region's step.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_PARTS, FULL_SLOT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { kinds } from '../__fixtures__/recordingPart';
import {
  CHORD_PATTERN_A,
  CHORD_PATTERN_B,
  REGION_PATTERN_CHORD,
} from '../__fixtures__/documentCases';
import {
  HALF,
  SONG,
  halves,
  patternOf,
  tickOf,
  twoRegionSong,
} from '../__fixtures__/regionPatternSongs';
import type { ChordSpec, PartRegion, RegionPattern } from './arrangement';
import { chordAt } from '../harmony/harmonyTimeline';
import { voiceHit, type ChordHitStep } from '../sequencing/chordSequencer';
import { gridNote } from '../sequencing/gridSequencer';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const { harmony } = FULL_ARRANGEMENT;
const sampler = new ScaleSampler(harmony);
const PATTERN_A = CHORD_PATTERN_A as unknown as ChordSpec;
const PATTERN_B = CHORD_PATTERN_B as unknown as ChordSpec;

/** What a chord pattern's hit sounds at a transport tick. */
const hitAt = (config: ChordSpec, step: number, tick: number): number[] =>
  voiceHit(sampler, config, config.steps[step] as ChordHitStep, chordAt(harmony, SONG, tick)!);

/** The document fixture's chord part on the drone slot. */
const chordSong = withPart(FULL_ARRANGEMENT, 'drone', {
  regions: REGION_PATTERN_CHORD.regions as unknown as PartRegion[],
  sequencer: REGION_PATTERN_CHORD.sequencer as unknown as ChordSpec,
});

/** A grid pattern of `length` notes on degrees 0.. at `divisor`, every step sounding. */
const gridLine = (divisor: number, length: number): RegionPattern => ({
  ...patternOf(FULL_PARTS.arp.sequencer),
  kind: 'grid',
  divisor,
  steps: Array.from({ length }, (_, degree) => gridNote(degree)),
  length,
  skipChance: 0,
});

describe('a chord part whose two regions carry their own patterns', () => {
  it('plays pattern A’s one hit a bar in bars 1–2 and pattern B’s eighths from bar 3', () => {
    const r = rig(chordSong);
    r.run(4);
    const ons = kinds(r.parts.drone, 'noteOn');
    const onTicks = [...new Set(ons.map((c) => tickOf(c.time)))];
    // B: two hits an eighth apart, then a quarter's rest, every half note.
    const bTicks = [0, 12, 48, 60, 96, 108, 144, 156].map((t) => HALF + t);
    expect(onTicks).toEqual([0, BAR, ...bTicks]);
    const notesAt = (tick: number) => ons.filter((c) => tickOf(c.time) === tick).map((c) => c.note);
    expect(notesAt(0)).toEqual(hitAt(PATTERN_A, 0, 0));
    expect(notesAt(BAR)).toEqual(hitAt(PATTERN_A, 0, BAR));
    for (const tick of bTicks) expect(notesAt(tick)).toEqual(hitAt(PATTERN_B, 0, tick));
    // Octave 3 close against octave 4 spread, first inversion: not the same chord.
    expect(hitAt(PATTERN_B, 0, HALF)).not.toEqual(hitAt(PATTERN_A, 0, HALF));
  });

  it('switches exactly at the second region’s start: A’s chord ends and B’s sounds on that tick', () => {
    const r = rig(chordSong);
    r.run(4);
    const at = (kind: 'noteOn' | 'noteOffByNote', tick: number) =>
      kinds(r.parts.drone, kind)
        .filter((c) => tickOf(c.time) === tick)
        .map((c) => c.note);
    expect(at('noteOffByNote', HALF)).toEqual(hitAt(PATTERN_A, 0, BAR));
    expect(at('noteOn', HALF)).toEqual(hitAt(PATTERN_B, 0, HALF));
    const beforeB = kinds(r.parts.drone, 'noteOn').filter((c) => tickOf(c.time) < HALF);
    expect(beforeB.map((c) => tickOf(c.time))).toEqual([0, 0, 0, BAR, BAR, BAR]);
  });

  it('re-enters A on the song’s wrap', () => {
    const r = rig(chordSong);
    r.run(5);
    const wrap = kinds(r.parts.drone, 'noteOn').filter((c) => tickOf(c.time) === SONG);
    expect(wrap.map((c) => c.note)).toEqual(hitAt(PATTERN_A, 0, SONG));
  });

  it('a region without a pattern plays the part’s sequencer beside one that has its own', () => {
    const own = withPart(FULL_ARRANGEMENT, 'drone', {
      regions: halves(undefined, CHORD_PATTERN_B as unknown as RegionPattern),
    });
    const r = rig(own);
    r.run(4);
    const firstHalf = kinds(r.parts.drone, 'noteOn').filter((c) => tickOf(c.time) < HALF);
    const whole = rig(FULL_ARRANGEMENT);
    whole.run(2);
    expect(firstHalf).toEqual(kinds(whole.parts.drone, 'noteOn'));
    const at = kinds(r.parts.drone, 'noteOn').filter((c) => tickOf(c.time) === HALF);
    expect(at.map((c) => c.note)).toEqual(hitAt(PATTERN_B, 0, HALF));
  });
});

describe('a region plays at its own divisor', () => {
  it('a grid at eighths in bars 1–2 and sixteenths in bars 3–4', () => {
    const r = rig(twoRegionSong('arp', gridLine(12, 8), gridLine(6, 3)));
    r.run(4);
    const ticks = kinds(r.parts.arp, 'noteOn').map((c) => tickOf(c.time));
    const expected = [
      ...Array.from({ length: HALF / 12 }, (_, i) => i * 12),
      ...Array.from({ length: HALF / 6 }, (_, i) => HALF + i * 6),
    ];
    expect(ticks).toEqual(expected);
  });

  it('a Euclidean part at sixteenths then eighths, each at its own note and hold', () => {
    const kick = patternOf(FULL_PARTS.kick.sequencer);
    const eighths: RegionPattern = { ...kick, divisor: 12, note: 38, hold: 0.5 };
    const r = rig(twoRegionSong('kick', kick, eighths));
    r.run(4);
    const triggers = kinds(r.parts.kick, 'trigger');
    const first = triggers.filter((c) => tickOf(c.time) < HALF);
    const second = triggers.filter((c) => tickOf(c.time) >= HALF);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first.every((c) => c.note === 36 && c.duration === 0.2)).toBe(true);
    expect(second.every((c) => c.note === 38 && c.duration === 0.5)).toBe(true);
    expect(second.every((c) => (tickOf(c.time) - HALF) % 12 === 0)).toBe(true);
  });
});

describe('the playhead reads the live region’s generator', () => {
  const song = twoRegionSong('arp', gridLine(12, 8), gridLine(6, 3));
  const { arp } = FULL_SLOT;

  it('each region answers at its own divisor and length', () => {
    const r = rig(song);
    expect(r.player.stepAt(arp, 5 * 12)).toBe(5);
    expect(r.player.stepAt(arp, HALF - 12)).toBe((HALF / 12 - 1) % 8);
    expect(r.player.stepAt(arp, HALF)).toBe(0);
    expect(r.player.stepAt(arp, HALF + 4 * 6)).toBe(1);
    expect(r.player.stepAt(arp, SONG + 3 * 12)).toBe(3);
  });

  it('a chord region answers with its own pattern’s step', () => {
    const r = rig(chordSong);
    const { drone } = FULL_SLOT;
    expect(r.player.stepAt(drone, BAR + 5)).toBe(0);
    expect(r.player.stepAt(drone, HALF + 12)).toBe(0);
    expect(r.player.stepAt(drone, HALF + 30)).toBe(1);
  });
});

describe('capturePattern per region', () => {
  it('captures the figure the named region plays, and the part’s own with no index', () => {
    const kick = patternOf(FULL_PARTS.kick.sequencer);
    const fixed: RegionPattern = { ...kick, pattern: Array.from({ length: 16 }, (_, i) => i < 2) };
    const r = rig(twoRegionSong('kick', kick, fixed));
    const { kick: slot } = FULL_SLOT;
    expect(r.player.capturePattern(slot, 1)).toEqual(fixed.kind === 'euclidean' && fixed.pattern);
    expect(r.player.capturePattern(slot, 0)).toEqual(r.player.capturePattern(slot));
    expect(r.player.capturePattern(slot, 0)).not.toEqual(r.player.capturePattern(slot, 1));
  });
});
