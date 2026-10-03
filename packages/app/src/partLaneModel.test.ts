/**
 * The part lanes' region editing (windsor#551): where the seams and edges
 * fall for the shared hit test, what a seam, edge or body drag from a press
 * makes of the regions and what its readout says, which region a press
 * lands on, and which handles light. The approved mockup's example lanes
 * are the fixtures: a Bass with regions touching at bar 5, a gap, and a
 * region to bar 15.
 */
import { describe, expect, it } from 'vitest';

import type { MusicPart, PartRegion, Region, RegionPattern } from '@windsor/engine';
import { DEFAULT_GRID_CONFIG, PPQ, TICKS_PER_BAR } from '@windsor/engine';
import { laneHitAt } from './laneEditModel';
import type { LaneScale } from './partLaneModel';
import {
  handleLights,
  partLaneGeometry,
  pressedRegion,
  regionDraft,
  seamGrains,
} from './partLaneModel';
import { SONG_VIEW, tickToPx } from './songViewTables';

const BAR = TICKS_PER_BAR;
const SONG = 16 * BAR;
const SCALE: LaneScale = { pxPerBar: 64, bar: BAR };
const region = (start: number, duration: number): Region => ({ start, duration });
/** The mockup's Bass: bars 1–4 and 5–8 touching at bar 5, then 11–14 after a gap. */
const BASS = [region(0, 4 * BAR), region(4 * BAR, 4 * BAR), region(10 * BAR, 4 * BAR)];
const grid = { ...DEFAULT_GRID_CONFIG, kind: 'grid' as const };
const part = (regions: PartRegion[]): Pick<MusicPart, 'regions' | 'sequencer'> => ({
  regions,
  sequencer: grid,
});
const px = (tick: number): number => tickToPx(tick, SCALE.pxPerBar, SCALE.bar);
const DRAG = { fine: false, bar: BAR, songTicks: SONG, meter: undefined };

describe('a part lane’s geometry', () => {
  it('has a seam only where two regions touch, and edges on every block', () => {
    const lane = partLaneGeometry(BASS, SCALE);
    expect(lane.edges).toBe(true);
    expect(lane.seams).toEqual([
      { index: 0, right: 1, px: px(4 * BAR), leftWidthPx: px(4 * BAR), rightWidthPx: px(4 * BAR) },
    ]);
    expect(lane.boxes.map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it('hits the seam before either edge, and an edge beside a gap as that region’s', () => {
    const lane = partLaneGeometry(BASS, SCALE);
    expect(laneHitAt(lane, px(4 * BAR) - 5)).toEqual({ kind: 'seam', index: 0 });
    expect(laneHitAt(lane, px(4 * BAR) + 5)).toEqual({ kind: 'seam', index: 0 });
    const end = (lane.boxes[1]?.leftPx ?? 0) + (lane.boxes[1]?.widthPx ?? 0);
    expect(laneHitAt(lane, end - 1)).toEqual({ kind: 'end', index: 1 });
    expect(laneHitAt(lane, px(10 * BAR) + 1)).toEqual({ kind: 'start', index: 2 });
    expect(laneHitAt(lane, px(2 * BAR))).toEqual({ kind: 'body', index: 0 });
    expect(laneHitAt(lane, px(9 * BAR))).toEqual({ kind: 'gap' });
  });

  it('keeps a widened one-beat block’s edges and body at the narrowest zoom, the later block on top', () => {
    const narrow = { pxPerBar: SONG_VIEW.minPxPerBar, bar: BAR };
    const lane = partLaneGeometry([region(2 * BAR, PPQ), region(4 * BAR, PPQ)], narrow);
    const box = lane.boxes[0];
    if (!box) throw new Error('no box');
    expect(laneHitAt(lane, box.leftPx)).toEqual({ kind: 'start', index: 0 });
    expect(laneHitAt(lane, box.leftPx + box.widthPx / 2)).toEqual({ kind: 'body', index: 0 });
    expect(laneHitAt(lane, box.leftPx + box.widthPx)).toEqual({ kind: 'end', index: 0 });
    const touching = partLaneGeometry([region(0, PPQ), region(PPQ, PPQ)], narrow);
    expect(touching.seams).toHaveLength(1);
    expect(laneHitAt(touching, (touching.boxes[1]?.leftPx ?? 0) + 3)).toEqual({
      kind: 'body',
      index: 1,
    });
  });
});

describe('a drag from a press', () => {
  it('rolls a seam by the pointer’s travel from the press, snapped, and reads both lengths', () => {
    // Pressed 4 px left of the seam: the boundary moves by the travel, never jumps to the pointer.
    const press = { hit: { kind: 'seam', index: 0 } as const, tick: 4 * BAR - PPQ / 2 };
    const draft = regionDraft(part(BASS), press, press.tick + 2 * BAR + 10, DRAG);
    expect(draft?.regions).toEqual([region(0, 6 * BAR), region(6 * BAR, 2 * BAR), BASS[2]]);
    expect(draft?.readout).toEqual({ tick: 6 * BAR, text: '7.1 · 6 bars | 2 bars' });
  });

  it('keeps a bar in each region of a rolled seam, at the song’s start and end', () => {
    const whole = [region(0, 8 * BAR), region(8 * BAR, 8 * BAR)];
    const press = { hit: { kind: 'seam', index: 0 } as const, tick: 8 * BAR };
    expect(regionDraft(part(whole), press, -SONG, DRAG)?.regions).toEqual([
      region(0, BAR),
      region(BAR, 15 * BAR),
    ]);
    expect(regionDraft(part(whole), press, 2 * SONG, DRAG)?.regions).toEqual([
      region(0, 15 * BAR),
      region(15 * BAR, BAR),
    ]);
  });

  it('trims an edge beside a gap only as far as the neighbour, reading over that edge', () => {
    const press = { hit: { kind: 'end', index: 1 } as const, tick: 8 * BAR };
    const draft = regionDraft(part(BASS), press, 12 * BAR, DRAG);
    expect(draft?.regions).toEqual([BASS[0], region(4 * BAR, 6 * BAR), BASS[2]]);
    expect(draft?.readout).toEqual({ tick: 10 * BAR, text: '5.1 → 11.1 · 6 bars' });
  });

  it('moves a body within its gap, reading over its middle', () => {
    const press = { hit: { kind: 'body', index: 2 } as const, tick: 12 * BAR };
    const draft = regionDraft(part(BASS), press, 13 * BAR + PPQ, DRAG);
    expect(draft?.regions[2]).toEqual(region(11 * BAR, 4 * BAR));
    expect(draft?.readout).toEqual({ tick: 13 * BAR, text: '12.1 → 16.1 · 4 bars' });
  });

  it('makes no draft from a gap, which draws instead', () => {
    expect(regionDraft(part(BASS), { hit: { kind: 'gap' }, tick: 9 * BAR }, SONG, DRAG)).toBeNull();
  });

  it('rolls on the finer of the two regions’ own steps', () => {
    const at = (divisor: number): RegionPattern => ({ ...grid, divisor });
    const regions: PartRegion[] = [
      { ...region(0, BAR), pattern: at(PPQ / 2) },
      { ...region(BAR, BAR), pattern: at(PPQ) },
    ];
    expect(seamGrains(part(regions), 0, false, BAR)).toEqual({ grain: BAR, step: PPQ / 2 });
    expect(seamGrains(part(regions), 0, true, BAR)).toEqual({ grain: PPQ / 2, step: PPQ / 2 });
  });
});

describe('a press without a drag, and the handles', () => {
  it('lands on the block it hit, or on a seam the region holding its tick', () => {
    expect(pressedRegion(BASS, { hit: { kind: 'seam', index: 0 }, tick: 4 * BAR - 1 })).toBe(0);
    expect(pressedRegion(BASS, { hit: { kind: 'seam', index: 0 }, tick: 4 * BAR })).toBe(1);
    expect(pressedRegion(BASS, { hit: { kind: 'end', index: 2 }, tick: 14 * BAR })).toBe(2);
    expect(pressedRegion(BASS, { hit: { kind: 'gap' }, tick: 9 * BAR })).toBe(-1);
  });

  it('light the edge under the pointer, and both faint on the selected block', () => {
    const end = { kind: 'end', index: 1 } as const;
    expect(handleLights(1, end, null)).toEqual(['', 'on']);
    expect(handleLights(1, end, 1)).toEqual(['faint', 'on']);
    expect(handleLights(0, end, 1)).toEqual(['', '']);
    expect(handleLights(2, { kind: 'seam', index: 1 }, 2)).toEqual(['faint', 'faint']);
  });
});
