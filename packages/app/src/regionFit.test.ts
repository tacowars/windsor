/**
 * Fit region to pattern (windsor#827): the issue's cases, over the cycle
 * `CYCLE_TICKS` draws, the next region and the song's end.
 */
import { describe, expect, it } from 'vitest';

import type { MusicPart, PartRegion, SequencerSpec } from '@windsor/engine';
import {
  DEFAULT_ARP_CONFIG,
  DEFAULT_BASS_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_FIGURE_CONFIG,
  DEFAULT_GRID_CONFIG,
  DEFAULT_ROLL_CONFIG,
  DIVISORS,
  PPQ,
  TICKS_PER_BAR,
  hitStep,
} from '@windsor/engine';
import { fitLengthText, regionFit } from './regionFit';

const BAR = TICKS_PER_BAR;
const SONG = { meter: '4/4', bar: BAR, songTicks: 16 * BAR } as const;
const bars = (first: number, length: number): PartRegion => ({
  start: (first - 1) * BAR,
  duration: length * BAR,
});
type FitPart = Pick<MusicPart, 'regions' | 'sequencer'>;
const part = (sequencer: SequencerSpec, regions: PartRegion[]): FitPart => ({
  sequencer,
  regions,
});

const grid = { ...DEFAULT_GRID_CONFIG, kind: 'grid', length: 16, divisor: DIVISORS.sixteenth };
const roll = (loopBars: number, notes = DEFAULT_ROLL_CONFIG.notes): SequencerSpec => ({
  ...DEFAULT_ROLL_CONFIG,
  kind: 'roll',
  loopTicks: loopBars * BAR,
  notes,
});
const NOTE = { tick: 0, pitch: 60, ticks: PPQ, velocity: 100 };

describe('regionFit', () => {
  it('fits a 4-bar Roll region on a 3-bar loop to 3 bars', () => {
    const fit = regionFit(part(roll(3, [NOTE]), [bars(5, 4)]), 0, SONG);
    expect(fit?.duration).toBe(3 * BAR);
    expect(fit?.regions[0]).toMatchObject({ start: 4 * BAR, duration: 3 * BAR });
    expect(fit?.tag).toBe('3 bars');
  });

  it('fits a 4-bar Grid region at 16 × 1/16 to 1 bar', () => {
    const fit = regionFit(part(grid as SequencerSpec, [bars(5, 4)]), 0, SONG);
    expect(fit).toMatchObject({ duration: BAR, fits: false, tag: '1 bar' });
  });

  it('says `already fits` on a region one pass long', () => {
    const fit = regionFit(part(grid as SequencerSpec, [bars(5, 1)]), 0, SONG);
    expect(fit).toMatchObject({ duration: BAR, fits: true, tag: 'already fits' });
  });

  it('stops at the next region, and at the song’s end', () => {
    const long = roll(4, [NOTE]);
    const next = regionFit(part(long, [bars(1, 1), bars(3, 2)]), 0, SONG);
    expect(next).toMatchObject({ duration: 2 * BAR, fits: false, tag: '2 bars' });
    expect(next?.regions[1]).toEqual(bars(3, 2));
    const end = regionFit(part(long, [bars(15, 1)]), 0, SONG);
    expect(end).toMatchObject({ duration: 2 * BAR, tag: '2 bars' });
    // No room to grow: the clipped length is the region's own.
    const boxed = regionFit(part(long, [bars(1, 1), bars(2, 2)]), 0, SONG);
    expect(boxed).toMatchObject({ duration: BAR, fits: true, tag: 'already fits' });
  });

  it('fits a Figure with no schedule to its line, and a Chord to its steps', () => {
    const line = { ...DEFAULT_FIGURE_CONFIG, kind: 'figure', length: 8, divisor: DIVISORS.eighth };
    expect(regionFit(part(line as SequencerSpec, [bars(1, 4)]), 0, SONG)?.tag).toBe('1 bar');
    const chord = {
      ...DEFAULT_CHORD_CONFIG,
      kind: 'chord',
      divisor: DIVISORS.quarter,
      steps: [hitStep({ duration: 2, repeat: 2 }), hitStep({ duration: 4 })],
    };
    const fit = regionFit(part(chord as SequencerSpec, [bars(1, 4)]), 0, SONG);
    expect(fit).toMatchObject({ duration: 2 * BAR, tag: '2 bars' });
  });

  it('offers none on an Arp, a Figure canon, or a Chord or Grid with no steps', () => {
    const none = (spec: SequencerSpec): void =>
      expect(regionFit(part(spec, [bars(1, 4)]), 0, SONG), spec.kind).toBeNull();
    none({ ...DEFAULT_ARP_CONFIG, kind: 'arp' });
    none({
      ...DEFAULT_FIGURE_CONFIG,
      kind: 'figure',
      source: { slot: 1, offset: 0, transpose: 0 },
    });
    none({ ...DEFAULT_CHORD_CONFIG, kind: 'chord', steps: [] });
    none({ ...grid, length: 0 } as SequencerSpec);
    none({ kind: 'none' });
  });

  it('fits a Roll with no notes to its loop', () => {
    const fit = regionFit(part(roll(2, []), [bars(1, 4)]), 0, SONG);
    expect(fit).toMatchObject({ duration: 2 * BAR, tag: '2 bars' });
  });

  it('grows a 1-bar region with a 4-bar cycle up to the next region 2 bars on', () => {
    const fit = regionFit(part(roll(4, [NOTE]), [bars(1, 1), bars(3, 4)]), 0, SONG);
    expect(fit).toMatchObject({ duration: 2 * BAR, tag: '2 bars' });
  });

  it('keeps a pass off the bar on the region’s step, and rounds one off it to the beat', () => {
    // A Grid's edges snap to its step: 7 sixteenths fit exactly.
    const seven = { ...grid, length: 7 } as SequencerSpec;
    const fit = regionFit(part(seven, [bars(1, 2)]), 0, SONG);
    expect(fit).toMatchObject({ duration: 7 * DIVISORS.sixteenth, tag: '1.75 beats' });
    // A Basslead's edges snap to the beat: 7 sixteenths round to 2 beats.
    const bass = { ...DEFAULT_BASS_CONFIG, kind: 'bass', length: 7, divisor: DIVISORS.sixteenth };
    const rounded = regionFit(part(bass as SequencerSpec, [bars(1, 2)]), 0, SONG);
    expect(rounded).toMatchObject({ duration: 2 * PPQ, tag: '2 beats' });
  });

  it('reads the region’s own pattern, not the part’s', () => {
    const own = { ...grid, length: 32 } as SequencerSpec;
    const fit = regionFit(
      part(grid as SequencerSpec, [{ ...bars(1, 4), pattern: own } as PartRegion]),
      0,
      SONG,
    );
    expect(fit?.tag).toBe('2 bars');
  });
});

describe('fitLengthText', () => {
  it('counts bars from one bar up, beats under it', () => {
    expect(fitLengthText(BAR, BAR)).toBe('1 bar');
    expect(fitLengthText(BAR + BAR / 4, BAR)).toBe('1.25 bars');
    expect(fitLengthText(PPQ, BAR)).toBe('1 beat');
    expect(fitLengthText(3 * PPQ, BAR)).toBe('3 beats');
  });
});
