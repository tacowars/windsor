/**
 * The region clipboard (record `2026-10-06-song-region-move-copy-paste`):
 * a clip holds a full copy of what the region plays, a cut removes it, a
 * paste lands on a part of the same kind only, a duplicate lands right
 * after the region, and a paste's start is the playhead's bar.
 */
import { describe, expect, it } from 'vitest';

import type { MusicPart, PartRegion } from '@windsor/engine';
import {
  DEFAULT_CHORD_CONFIG,
  DEFAULT_EUCLIDEAN_CONFIG,
  DEFAULT_GRID_CONFIG,
  PPQ,
  TICKS_PER_BAR,
} from '@windsor/engine';
import { patternCopy } from './partEdits';
import { copyRegion, cutRegion, duplicateRegion, pasteRegion, pasteTick } from './regionClipboard';

const BAR = TICKS_PER_BAR;
const SONG = 8 * BAR;
const grid = { ...DEFAULT_GRID_CONFIG, kind: 'grid' as const };
const chord = { ...DEFAULT_CHORD_CONFIG, kind: 'chord' as const };
type LanePart = Pick<MusicPart, 'regions' | 'sequencer'>;
const gridPart = (regions: PartRegion[]): LanePart => ({ regions, sequencer: grid });
const region = (start: number, duration: number): PartRegion => ({ start, duration });

describe('copy and cut', () => {
  it("copies a region without a pattern of its own as the part's sequencer, less its seed", () => {
    const part = gridPart([region(0, 2 * BAR)]);
    expect(copyRegion(part, 0)).toEqual({
      kind: 'grid',
      duration: 2 * BAR,
      pattern: patternCopy(part, 0),
    });
    expect(copyRegion(part, 0)?.pattern).not.toHaveProperty('seed');
    expect(copyRegion(part, 3)).toBeNull();
  });

  it("carries a patternless Euclidean region's sequencer to another Euclidean part", () => {
    const euclid = { ...DEFAULT_EUCLIDEAN_CONFIG, kind: 'euclidean' as const, note: 60, hold: 1 };
    const source: LanePart = { regions: [region(0, BAR)], sequencer: { ...euclid, rotate: 3 } };
    const target: LanePart = { regions: [], sequencer: { ...euclid, rotate: 7 } };
    const clip = copyRegion(source, 0);
    if (!clip) throw new Error('no clip');
    expect(clip.pattern).toEqual(patternCopy(source, 0));
    const placed = pasteRegion(target, clip, 0, SONG);
    expect('regions' in placed && placed.regions[0]?.pattern).toMatchObject({
      kind: 'euclidean',
      rotate: 3,
    });
  });

  it('cuts: the clip, and the lane without the region', () => {
    const cut = cutRegion(gridPart([region(0, BAR), region(2 * BAR, BAR)]), 0);
    expect(cut?.clip.duration).toBe(BAR);
    expect(cut?.regions).toEqual([region(2 * BAR, BAR)]);
  });
});

describe('paste and duplicate', () => {
  it('pastes over the lane at a start, keeping the copied pattern', () => {
    const source = gridPart([region(0, 2 * BAR)]);
    const clip = copyRegion(source, 0);
    if (!clip) throw new Error('no clip');
    const placed = pasteRegion(gridPart([region(0, SONG)]), clip, 4 * BAR, SONG);
    expect(placed).toEqual({
      regions: [
        region(0, 4 * BAR),
        { start: 4 * BAR, duration: 2 * BAR, pattern: clip.pattern },
        region(6 * BAR, 2 * BAR),
      ],
      index: 1,
    });
  });

  it('refuses a paste onto a part playing another kind', () => {
    const clip = copyRegion(gridPart([region(0, BAR)]), 0);
    if (!clip) throw new Error('no clip');
    const placed = pasteRegion({ regions: [], sequencer: chord }, clip, 0, SONG);
    expect(placed).toHaveProperty('refused');
  });

  it('duplicates right after the region, over its neighbour, and not past the song', () => {
    const part = gridPart([region(0, 2 * BAR), region(2 * BAR, 4 * BAR)]);
    const placed = duplicateRegion(part, 0, SONG);
    expect(placed?.regions.map((r) => [r.start, r.duration])).toEqual([
      [0, 2 * BAR],
      [2 * BAR, 2 * BAR],
      [4 * BAR, 2 * BAR],
    ]);
    expect(placed?.index).toBe(1);
    expect(duplicateRegion(gridPart([region(6 * BAR, 2 * BAR)]), 0, SONG)).toBeNull();
  });

  it("starts a paste on the playhead's bar, wrapped into the song", () => {
    expect(pasteTick(3 * BAR + PPQ, SONG)).toBe(3 * BAR);
    expect(pasteTick(SONG + BAR + 1, SONG)).toBe(BAR);
    expect(pasteTick(0, 0)).toBe(0);
  });
});
