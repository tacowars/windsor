/**
 * The Euclid card's density readouts (windsor#356, decision 2): the tab
 * row's one-line note, and the Density page's plot of `k` — an LFO's `k`
 * bar by bar, read as the sequencer reads it on a bar line.
 */
import { describe, expect, it } from 'vitest';

import type { EuclideanSpec, TickEvent } from '@windsor/engine';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  EuclideanSequencer,
  TICKS_PER_BAR,
  TickTransport,
  lfoValue,
} from '@windsor/engine';
import {
  FULL_DOCUMENT,
  FULL_PARTS,
  FULL_SLOT,
  withDocumentPart,
} from '@windsor/engine/__fixtures__/fullArrangement';
import { rig } from '@windsor/engine/__fixtures__/playerRig';
import { HALF, halves, patternOf } from '@windsor/engine/__fixtures__/regionPatternSongs';
import {
  barLineSeconds,
  densityKindText,
  densityNote,
  lfoKs,
  plotBar,
  plotPath,
  plotScale,
  plotY,
} from './euclidDensityModel';
import { EUCLID_PLOT } from './euclidConstants';
import { countOnsets } from './euclidModel';

const SPEC: EuclideanSpec = {
  ...DEFAULT_EUCLIDEAN_CONFIG,
  kind: 'euclidean',
  note: 50,
  hold: 0.1,
  pulses: { min: 4, max: 9, start: 7 },
  density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
  pattern: null,
};

describe('the tab row note', () => {
  it('reads k, its bounds and the modulator', () => {
    expect(densityNote(SPEC, 7)).toBe('k 7 · 4–9 · tri · 8 bars');
    expect(densityKindText({ kind: 'lfoHz', hz: 0.25, shape: 'sine' })).toBe('sine · 0.25 Hz');
    expect(densityKindText({ kind: 'walk', stepChance: 0.5 })).toBe('walk · 0.5');
  });

  it('reads captured for a frozen figure', () => {
    expect(densityNote({ ...SPEC, pattern: new Array(16).fill(false) }, 0)).toBe('captured');
  });
});

describe('the plot of k', () => {
  it("gives each bar the k the sequencer cuts on that bar's line", () => {
    const ks = lfoKs(SPEC, { bar: 0, seconds: 0, secondsPerBar: 2 }, 16);
    const want = Array.from(
      { length: 16 },
      (_, bar) => 4 + Math.round(lfoValue('tri', bar / 8) * 5),
    );
    expect(ks).toEqual(want);
    expect(ks[0]).toBe(9);
    expect(ks[4]).toBe(4);
    // The sequencer on bar 4's line agrees.
    const sequencer = new EuclideanSequencer(SPEC);
    const bar4: TickEvent = {
      tick: 0,
      step: 0,
      bar: 4,
      tickInBar: 0,
      seconds: 0,
      secondsPerTick: 0.02,
      time: 0,
    };
    sequencer.handleTick(bar4);
    expect(sequencer.currentK).toBe(ks[4]);
  });

  it("reads an Hz LFO from the bar line's transport seconds, a bar's seconds apart", () => {
    const hz = { ...SPEC, density: { kind: 'lfoHz', hz: 0.25, shape: 'saw' } } as const;
    // The region's own bar does not enter an Hz LFO: only the seconds do.
    const ks = lfoKs(hz, { bar: 0, seconds: 5, secondsPerBar: 2 }, 2);
    expect(ks).toEqual([0, 1].map((i) => 4 + Math.round(lfoValue('saw', (5 + i * 2) * 0.25) * 5)));
  });

  it('has no path for a walk', () => {
    expect(
      lfoKs(
        { ...SPEC, density: { kind: 'walk', stepChance: 0.5 } },
        { bar: 0, seconds: 0, secondsPerBar: 2 },
        16,
      ),
    ).toEqual([]);
  });

  it('scales k inside the box, a margin past each bound', () => {
    const scale = plotScale(SPEC);
    expect(scale).toEqual({ lo: 2, hi: 11 });
    expect(plotY(scale.lo, scale)).toBe(EUCLID_PLOT.height - EUCLID_PLOT.pad);
    expect(plotY(scale.hi, scale)).toBe(EUCLID_PLOT.pad);
    expect(plotPath([scale.hi, scale.lo], scale)).toBe(
      `M0.0 ${EUCLID_PLOT.pad.toFixed(1)}H100.0L100.0 ${(EUCLID_PLOT.height - EUCLID_PLOT.pad).toFixed(1)}H200.0`,
    );
  });
});

describe("the plot's bar", () => {
  const BAR = TICKS_PER_BAR;
  const slot = FULL_SLOT.kick;
  const kick = FULL_PARTS.kick.sequencer;
  /** The kick in two regions, the second entered on bar 3 (`HALF`), played through. */
  const played = () => {
    const doc = withDocumentPart(FULL_DOCUMENT, 'kick', {
      regions: halves(patternOf(kick), patternOf(kick)),
    });
    const r = rig(doc);
    r.run((2 * HALF) / BAR);
    return r.player;
  };

  it("starts a region entered after bar 1 on its own bar 0, as the sequencer's bar does", () => {
    const player = played();
    const { divisor } = kick;
    // Region 2 begins on bar 3: at its entry the sequencer hears local bar 0, not song bar 2.
    expect(plotBar(player.regionStepAt(slot, 1, HALF), divisor, HALF / BAR)).toBe(0);
    expect(plotBar(player.regionStepAt(slot, 1, HALF + BAR), divisor, HALF / BAR + 1)).toBe(1);
    // Out of region 2, on bar 1: its phase there, the bar its ghost playhead stands on.
    const ghost = player.regionStepAt(slot, 1, 0);
    expect(ghost?.live).toBe(false);
    expect(ghost?.localStep).toBeTypeOf('number');
    const want = Math.floor(((ghost?.localStep ?? Number.NaN) * divisor) / BAR);
    expect(plotBar(ghost, divisor, 0)).toBe(want);
  });

  it("falls back to the song's bar with no region step", () => {
    expect(plotBar(null, 6, 5)).toBe(5);
    expect(plotBar({ step: 3, live: true }, 6, 5)).toBe(5);
  });
});

describe("the plot's transport seconds", () => {
  const BAR = TICKS_PER_BAR;
  const slot = FULL_SLOT.kick;
  const kick = FULL_PARTS.kick.sequencer;

  it('starts an Hz plot on the seconds a later region is entered at, as the sequencer reads them', () => {
    // 0.1 Hz from bar 3 at the fixture's 96 BPM: the sequencer enters 5 s in, at phase 0.5,
    // where the region's own bar 0 would say phase 0.
    const hz: EuclideanSpec = {
      ...kick,
      pulses: { min: 1, max: 12, start: 4 },
      density: { kind: 'lfoHz', hz: 0.1, shape: 'saw' },
    };
    const doc = withDocumentPart(FULL_DOCUMENT, 'kick', {
      regions: halves(patternOf(kick), patternOf(hz)),
    });
    const r = rig(doc);
    r.run(HALF / BAR);
    // Region 2's first tick: the sequencer cuts its k on that bar line.
    r.transport.advance(r.transport.transportSeconds);
    const played = countOnsets(r.player.capturePattern(slot, 1) ?? []);
    const at = r.player.regionStepAt(slot, 1, HALF);
    const seconds = barLineSeconds(r.transport, HALF);
    const secondsPerBar = BAR * r.transport.secondsPerTick;
    const clock = { bar: plotBar(at, kick.divisor, HALF / BAR), seconds, secondsPerBar };
    expect(seconds).toBeCloseTo(5, 9);
    expect(lfoKs(hz, clock, 1)[0]).toBe(played);
    // The region-local bar's seconds (bar 0, phase 0) would plot another k.
    expect(clock.bar).toBe(0);
    expect(lfoKs(hz, { ...clock, seconds: 0 }, 1)[0]).not.toBe(played);
  });

  it("winds the look-ahead's seconds back to the audible bar's line", () => {
    const clock = new TickTransport(120);
    for (let i = 0; i < BAR + 10; i++) clock.advance(0);
    // The queue is 10 ticks into bar 2; the ear is still on bar 1's last tick.
    expect(barLineSeconds(clock, BAR - 1)).toBeCloseTo(0, 9);
    expect(barLineSeconds(clock, BAR + 3)).toBeCloseTo(2, 9);
  });

  it('winds back through a loop jump the look-ahead has already taken', () => {
    const clock = new TickTransport(120);
    clock.loop = { start: 0, end: 2 * BAR, songTicks: 4 * BAR };
    for (let i = 0; i < 2 * BAR + 5; i++) clock.advance(0);
    // The counter jumped from bar 2's end back to 0 and is 5 ticks on; the ear is on bar 2.
    expect(clock.currentTick).toBe(5);
    expect(barLineSeconds(clock, 2 * BAR - 1)).toBeCloseTo(2, 9);
    // On the loop's first bar again: 4 s in, the seconds keep running across the jump.
    expect(barLineSeconds(clock, 2)).toBeCloseTo(4, 9);
  });
});
