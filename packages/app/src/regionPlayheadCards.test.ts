/**
 * The chord and Euclidean cards' playhead through the real player
 * (windsor#101): `regionPlayheadAt` over an `ArrangementPlayer` built from
 * the engine's fixtures, read tick by tick, against what each card draws —
 * the chord card one column per written step, the Euclidean card one cell
 * per step of its (rotated) figure.
 *
 * The song is the fixture's four bars. The chord part (the drone slot) has
 * a three-step progression in bars 1–2 — a hit two beats long, a hit one
 * beat long played twice, a two-beat rest, so a six-beat cycle that does
 * not divide the region or the song — and a one-step region starting mid-bar in bar 3.
 * The Euclidean part (the kick slot) has an eight-step figure rotated by one
 * in bars 1–2 and a six-step one in bar 3; bar 4 is empty for both.
 *
 * Pinned: the step lit is the column or cell the player is on, bright in
 * the region and a ghost outside it; it keeps going through every pattern
 * repeat and after the song wraps to bar 1; the ghost turns bright on step
 * 1 as the song enters; the ∞ region free-runs; and every Euclidean onset
 * the player sounds lands on a lit cell of the figure the card draws.
 */
import { describe, expect, it } from 'vitest';

import type {
  ChordStep,
  EuclideanSpec,
  MusicPart,
  PartRegion,
  RegionPattern,
} from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import {
  FULL_ARRANGEMENT,
  FULL_PARTS,
  FULL_SLOT,
  FULL_SONG_TICKS,
  onlyParts,
} from '@windsor/engine/__fixtures__/fullArrangement';
import { rig } from '@windsor/engine/__fixtures__/playerRig';
import { patternOf, tickOf } from '@windsor/engine/__fixtures__/regionPatternSongs';
import type { AppCtx } from './context';
import { previewFigure } from './euclidModel';
import { readPlayhead, regionPlayheadAt } from './regionPlayhead';

const BAR = TICKS_PER_BAR;
const SONG = FULL_SONG_TICKS;
const BEAT = BAR / 4;
const { drone: CHORD, kick: EUCLID } = FULL_SLOT;

const hit = (duration: number, repeat: number): ChordStep => ({
  kind: 'hit',
  duration,
  repeat,
  inversion: 0,
  octave: 0,
});
const rest = (duration: number): ChordStep => ({ kind: 'rest', duration, repeat: 1 });

const chordPattern = (steps: ChordStep[]): RegionPattern => ({
  ...patternOf(FULL_PARTS.drone.sequencer),
  divisor: BEAT,
  steps,
});

/** Bars 1–2's progression, and the column each tick of its cycle is on: 2 + 1×2 + 2 beats. */
const PROGRESSION = chordPattern([hit(2, 1), hit(1, 2), rest(2)]);
const COLUMN_BY_BEAT = [0, 0, 1, 1, 2, 2];
const CYCLE = COLUMN_BY_BEAT.length * BEAT;
const columnAt = (phase: number): number =>
  COLUMN_BY_BEAT[Math.floor((phase % CYCLE) / BEAT)] as number;

const euclidPattern = (steps: number, k: number, rotate: number): RegionPattern => ({
  ...patternOf(FULL_PARTS.kick.sequencer),
  steps,
  divisor: BEAT / 2,
  pulses: { min: k, max: k, start: k },
  rotate,
});
const EIGHT = euclidPattern(8, 3, 1);
const SIX = euclidPattern(6, 2, 0);

/** Bars 1–2, then a region of `second` in bar 3 starting `offset` ticks in. */
function twoRegions(
  first: RegionPattern,
  second: RegionPattern,
  offset: number,
  length: number,
): PartRegion[] {
  return [
    { start: 0, duration: 2 * BAR, pattern: first },
    { start: 2 * BAR + offset, duration: length, pattern: second },
  ];
}

const REGIONS: Record<number, PartRegion[]> = {
  [CHORD]: twoRegions(PROGRESSION, chordPattern([hit(1, 1)]), 2 * BEAT, BEAT),
  [EUCLID]: twoRegions(EIGHT, SIX, 0, BAR),
};

/** The fixture song with the chord and Euclidean parts only, in `regions` (the ones above by default). */
function player(regions: Record<number, PartRegion[]> = REGIONS): ReturnType<typeof rig> {
  const base = onlyParts(FULL_ARRANGEMENT, 'kick', 'drone');
  const parts = base.parts.map(
    (part): MusicPart => ({ ...part, regions: regions[part.slot] ?? part.regions }),
  );
  return rig({ ...base, parts });
}

/** A console context whose engine is the rig's player, the transport running at `tick`. */
function consoleOn(r: ReturnType<typeof rig>): { ctx: AppCtx; at: { tick: number } } {
  const at = { tick: 0 };
  const ctx = {
    host: {
      stepAt: (slot: number, tick: number) => r.player.stepAt(slot, tick),
      regionStepAt: (slot: number, region: number, tick: number) =>
        r.player.regionStepAt(slot, region, tick),
    },
    transport: { running: true, position: (): number => at.tick },
  } as unknown as AppCtx;
  return { ctx, at };
}

/** The lit step and its strength for `slot`'s region `region` at `tick`. */
function litAt(
  view: ReturnType<typeof consoleOn>,
  slot: number,
  region: number,
  tick: number,
): { step: number; ghost: boolean } | null {
  view.at.tick = tick;
  return readPlayhead(regionPlayheadAt(view.ctx, slot, region));
}

const inRegion = (region: PartRegion, tick: number): boolean => {
  const songTick = tick % SONG;
  return songTick >= region.start && songTick < region.start + region.duration;
};

describe('the chord card’s playhead', () => {
  it('lights the written column, durations and repeats included, bright in the region and a ghost after it, over two passes', () => {
    const view = consoleOn(player());
    for (let tick = 0; tick < 2 * SONG; tick++) {
      expect(litAt(view, CHORD, 0, tick), `tick ${tick}`).toEqual({
        step: columnAt(tick % SONG),
        ghost: !inRegion(REGIONS[CHORD]![0]!, tick),
      });
    }
  });

  it('turns bright on the first column as the song wraps into the region, whatever the ghost was on', () => {
    const view = consoleOn(player());
    // The ghost has run on to the middle of the cycle, and would carry on to column 3.
    expect(litAt(view, CHORD, 0, SONG - 1)).toEqual({ step: columnAt(SONG - 1), ghost: true });
    expect(columnAt(SONG - 1)).not.toBe(0);
    expect(columnAt(SONG)).not.toBe(0);
    expect(litAt(view, CHORD, 0, SONG)).toEqual({ step: 0, ghost: false });
  });

  it('a one-step region starting mid-bar: bright only on its own beat, its ghost on step 1 elsewhere', () => {
    const view = consoleOn(player());
    const region = REGIONS[CHORD]![1]!;
    for (let tick = 0; tick < 2 * SONG; tick++) {
      const lit = litAt(view, CHORD, 1, tick);
      expect(lit, `tick ${tick}`).toEqual({ step: 0, ghost: !inRegion(region, tick) });
    }
  });

  it('the adjacent region’s ghost runs while the other one plays, and each is bright in its own', () => {
    const adjacent = { ...REGIONS, [CHORD]: twoRegions(PROGRESSION, PROGRESSION, 0, BAR) };
    const view = consoleOn(player(adjacent));
    const [first, second] = adjacent[CHORD] as [PartRegion, PartRegion];
    // The tick region 2 starts: region 1 goes to its ghost, region 2 bright on step 1.
    expect(litAt(view, CHORD, 0, second.start)).toEqual({
      step: columnAt(second.start),
      ghost: true,
    });
    expect(litAt(view, CHORD, 1, second.start)).toEqual({ step: 0, ghost: false });
    expect(litAt(view, CHORD, 1, second.start - 1)?.ghost).toBe(true);
    expect(litAt(view, CHORD, 0, first.start + first.duration - 1)?.ghost).toBe(false);
  });

  it('an ∞ region free-runs on the transport tick, bright throughout', () => {
    const infinite = { ...REGIONS, [CHORD]: [{ start: 0, duration: SONG, pattern: PROGRESSION }] };
    const view = consoleOn(player(infinite));
    // Past the song's end the cycle carries on rather than restarting at bar 1.
    const tick = SONG + 4 * BEAT;
    expect(columnAt(tick)).not.toBe(columnAt(tick % SONG));
    expect(litAt(view, CHORD, 0, tick)).toEqual({ step: columnAt(tick), ghost: false });
  });
});

describe('the Euclidean card’s playhead', () => {
  it('rings the cell the player is on: every onset it sounds lands on a lit, onset cell of the rotated figure', () => {
    const r = player();
    const view = consoleOn(r);
    r.run((2 * SONG) / BAR);
    const onsets = r.parts.kick.calls.filter((call) => call.kind === 'trigger');
    expect(onsets.length).toBeGreaterThan(0);
    const figures = [EIGHT, SIX].map((p) => previewFigure({ ...p, seed: 0 } as EuclideanSpec));
    for (const call of onsets) {
      const tick = tickOf(call.time);
      const region = inRegion(REGIONS[EUCLID]![0]!, tick) ? 0 : 1;
      const lit = litAt(view, EUCLID, region, tick);
      expect(lit?.ghost, `tick ${tick}`).toBe(false);
      expect(figures[region]?.[lit?.step ?? -1], `tick ${tick}`).toBe(true);
    }
    // Rotation moved the onsets off the plain Euclidean positions: step 0 is silent.
    expect(figures[0]?.[0]).toBe(false);
  });

  it('steps a ghost through the figure while the song is outside the region, and is bright on cell 1 at entry', () => {
    const view = consoleOn(player());
    const step = BEAT / 2;
    const ghosts = [];
    for (let tick = 2 * BAR; tick < SONG; tick += step) ghosts.push(litAt(view, EUCLID, 0, tick));
    expect(ghosts.every((lit) => lit?.ghost === true)).toBe(true);
    expect(ghosts.map((lit) => lit?.step)).toEqual(
      Array.from({ length: ghosts.length }, (_, i) => i % 8),
    );
    expect(litAt(view, EUCLID, 0, SONG)).toEqual({ step: 0, ghost: false });
    expect(litAt(view, EUCLID, 0, SONG + 3 * step)).toEqual({ step: 3, ghost: false });
  });
});
