/**
 * The region menu's pattern group (windsor#827): each kind's rows beyond the
 * mockups' states (`songLaneMenuModel.test.ts` has those), the rows the card
 * turns off, Fit's tags, and what the rows run and preview.
 */
import { describe, expect, it } from 'vitest';

import type { MusicPart, PartRegion, SequencerSpec } from '@windsor/engine';
import {
  DEFAULT_BASS_CONFIG,
  DEFAULT_CHORD_CONFIG,
  DEFAULT_EUCLIDEAN_CONFIG,
  DEFAULT_FIGURE_CONFIG,
  DEFAULT_GRID_CONFIG,
  DEFAULT_ROLL_CONFIG,
  TICKS_PER_BAR,
  hitStep,
} from '@windsor/engine';
import type { MenuItem, MenuRow } from './contextMenuModel';
import { regionFit } from './regionFit';
import { ROLL_SNAPS, ROLL_SNAP_OFF_TICKS } from './rollTables';
import type { PatternGroupCommands, PatternGroupPress } from './songLanePatternGroup';
import { patternGroup } from './songLanePatternGroup';

const BAR = TICKS_PER_BAR;
const SNAP_16 = ROLL_SNAPS.find((s) => s.label === '1/16') ?? { label: '1/16', ticks: 6 };
const SNAP_OFF = ROLL_SNAPS.find((s) => s.ticks === ROLL_SNAP_OFF_TICKS) ?? SNAP_16;
const bars = (first: number, length: number): PartRegion => ({
  start: (first - 1) * BAR,
  duration: length * BAR,
});

type GroupPart = Pick<MusicPart, 'regions' | 'sequencer'>;
const press = (
  sequencer: SequencerSpec,
  regions: PartRegion[] = [bars(1, 4)],
  snap = SNAP_16,
): PatternGroupPress => ({
  part: { sequencer, regions } as GroupPart,
  meter: '4/4',
  bar: BAR,
  songTicks: 16 * BAR,
  snap,
});

function spy(): { commands: PatternGroupCommands; calls: [string, ...unknown[]][] } {
  const calls: [string, ...unknown[]][] = [];
  const commands: PatternGroupCommands = {
    pattern: (index, action) => void calls.push(['pattern', index, action]),
    place: (placed) => void calls.push(['place', placed]),
    showRegion: (span) => void calls.push(['showRegion', span]),
    unpreview: () => void calls.push(['unpreview']),
  };
  return { commands, calls };
}

const shown = (items: readonly MenuItem[]): string[] =>
  items.map((item) => {
    if (item.kind !== 'row') return item.kind;
    const tag = item.tag === undefined ? '' : ` [${item.tag}]`;
    return `${item.label}${tag}${item.disabled === true ? ' (off)' : ''}`;
  });

const group = (p: PatternGroupPress, index = 0): string[] =>
  shown(patternGroup(p, index, spy().commands));

const grid = { ...DEFAULT_GRID_CONFIG, kind: 'grid' } as SequencerSpec;
const figure = { ...DEFAULT_FIGURE_CONFIG, kind: 'figure' } as SequencerSpec;
const roll = (notes = DEFAULT_ROLL_CONFIG.notes): SequencerSpec => ({
  ...DEFAULT_ROLL_CONFIG,
  kind: 'roll',
  loopTicks: 2 * BAR,
  notes,
});

describe('each kind’s group', () => {
  it('Basslead and Figure: Randomize, Reverse, Reseed and Fit', () => {
    const bass = { ...DEFAULT_BASS_CONFIG, kind: 'bass' } as SequencerSpec;
    const rows = ['Randomize', 'Reverse', 'Reseed', 'Fit region to pattern [1 bar]'];
    expect(group(press(bass))).toEqual(rows);
    expect(group(press(figure))).toEqual(rows);
  });

  it('a Figure canon: Randomize and Reverse off with the card’s reason, Reseed on, no Fit', () => {
    const canon = { ...figure, source: { slot: 1, offset: 2, transpose: 0 } } as SequencerSpec;
    expect(group(press(canon))).toEqual([
      'Randomize [follows its source] (off)',
      'Reverse [follows its source] (off)',
      'Reseed',
    ]);
  });

  it('Euclid: Release once captured', () => {
    const pattern = Array.from({ length: 16 }, (_, i) => i % 4 === 0);
    const kick = { ...DEFAULT_EUCLIDEAN_CONFIG, kind: 'euclidean', note: 36, hold: 1, pattern };
    expect(group(press(kick as SequencerSpec))[0]).toBe('Release');
  });

  it('Roll: Quantize off at Snap Off with the card’s tag; with no notes it keeps Fit', () => {
    expect(group(press(roll(), [bars(1, 4)], SNAP_OFF))).toEqual([
      'Quantize [snap off] (off)',
      'Fit region to pattern [2 bars]',
    ]);
  });

  it('Chord: Fit alone, and nothing on a Chord with no steps', () => {
    const steps = [hitStep(), hitStep()];
    const chord = { ...DEFAULT_CHORD_CONFIG, kind: 'chord', steps } as SequencerSpec;
    expect(group(press(chord))).toEqual(['Fit region to pattern [2 bars]']);
    const empty = { ...DEFAULT_CHORD_CONFIG, kind: 'chord', steps: [] } as SequencerSpec;
    expect(group(press(empty))).toEqual([]);
  });

  it('Fit is off with `already fits` on a region one pass long', () => {
    expect(group(press(grid, [bars(1, 1)]))).toEqual([
      'Randomize',
      'Reverse',
      'Reseed',
      'Fit region to pattern [already fits] (off)',
    ]);
  });
});

describe('what the rows run', () => {
  const row = (items: readonly MenuItem[], label: string): MenuRow => {
    const item = items.find((i) => i.kind === 'row' && i.label.startsWith(label));
    if (item?.kind !== 'row') throw new Error(`no row ${label}`);
    return item;
  };

  it('an action runs on the pressed region, and Fit previews and commits the fit', () => {
    const { commands, calls } = spy();
    const p = press(grid, [bars(1, 1), bars(5, 4)]);
    const items = patternGroup(p, 1, commands);
    row(items, 'Reverse').run();
    const fit = row(items, 'Fit');
    fit.preview?.();
    fit.unpreview?.();
    fit.run();
    const fitted = regionFit(p.part, 1, p);
    expect(calls).toEqual([
      ['pattern', 1, 'reverse'],
      ['showRegion', bars(5, 1)],
      ['unpreview'],
      ['place', { regions: fitted?.regions, index: 1 }],
    ]);
  });
});
