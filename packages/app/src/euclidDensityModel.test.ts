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
  densityKindText,
  densityNote,
  lfoKs,
  plotBar,
  plotPath,
  plotScale,
  plotY,
} from './euclidDensityModel';
import { EUCLID_PLOT } from './euclidConstants';

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
    const ks = lfoKs(SPEC, { bar: 0, secondsPerBar: 2 }, 16);
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

  it('reads an Hz LFO by the seconds a bar lasts, from the current bar', () => {
    const hz = { ...SPEC, density: { kind: 'lfoHz', hz: 0.25, shape: 'saw' } } as const;
    const ks = lfoKs(hz, { bar: 2, secondsPerBar: 2 }, 2);
    expect(ks).toEqual([0, 1].map((i) => 4 + Math.round(lfoValue('saw', (2 + i) * 2 * 0.25) * 5)));
  });

  it('has no path for a walk', () => {
    expect(
      lfoKs(
        { ...SPEC, density: { kind: 'walk', stepChance: 0.5 } },
        { bar: 0, secondsPerBar: 2 },
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
