/**
 * A region dragged onto another part (record
 * `2026-10-07-song-region-drag-across-parts`): it plays what copy and
 * paste of it would, lands snapped and whole over what it meets, leaves
 * the source without it on a move and as it was on a copy, and is refused
 * onto another kind in Paste's words.
 */
import { describe, expect, it } from 'vitest';

import type { MusicPart, PartRegion, RegionPattern } from '@windsor/engine';
import {
  DEFAULT_EUCLIDEAN_CONFIG,
  DEFAULT_GRID_CONFIG,
  DEFAULT_ROLL_CONFIG,
  PPQ,
  TICKS_PER_BAR,
} from '@windsor/engine';
import { copyRegion, pasteRegion } from './regionClipboard';
import type { DragKeys, RegionDrop } from './regionTransfer';
import { dragModifiers, regionDropAt, transferRegion } from './regionTransfer';

const BAR = TICKS_PER_BAR;
const SONG = 8 * BAR;
type LanePart = Pick<MusicPart, 'regions' | 'sequencer'>;
const rollSeq = { ...DEFAULT_ROLL_CONFIG, kind: 'roll' as const };
const note = (tick: number, pitch: number): RegionPattern => ({
  kind: 'roll',
  loopTicks: BAR,
  notes: [{ tick, ticks: PPQ, pitch }],
});
const held = (start: number, duration: number, pattern: RegionPattern): PartRegion => ({
  start,
  duration,
  pattern,
});
const rollPart = (regions: PartRegion[]): LanePart => ({ regions, sequencer: rollSeq });
const drop = (index: number, tick: number, copy = false): RegionDrop => ({
  index,
  tick,
  copy,
  songTicks: SONG,
  grain: BAR,
});

describe('a region dropped onto another part', () => {
  const a = held(0, BAR, note(0, 60));
  const b = held(2 * BAR, BAR, note(PPQ, 64));

  it('moves to the snapped start: the source loses it, the target gains it, as copy and paste would', () => {
    const source = rollPart([a, b]);
    const target = rollPart([]);
    const moved = transferRegion(source, target, drop(1, 3 * BAR + PPQ));
    const clip = copyRegion(source, 1);
    const pasted = clip && pasteRegion(target, clip, 3 * BAR, SONG);
    if (!pasted || !('regions' in pasted)) throw new Error('no paste');
    expect(moved).toEqual({ source: [a], target: pasted.regions, index: pasted.index });
    expect(pasted.regions).toEqual([{ ...b, start: 3 * BAR }]);
  });

  it('copies with Cmd/Ctrl, leaving the source as it was', () => {
    const source = rollPart([a, b]);
    const copied = transferRegion(source, rollPart([]), drop(0, 4 * BAR, true));
    expect(copied).toMatchObject({ source: [a, b], target: [{ ...a, start: 4 * BAR }], index: 0 });
  });

  it('snaps to the grain it is given (Shift: the step) and keeps the region whole inside the song', () => {
    const source = rollPart([held(0, 2 * BAR, note(0, 60))]);
    const fine = transferRegion(source, rollPart([]), { ...drop(0, BAR + PPQ + 7), grain: PPQ });
    expect(fine).toMatchObject({ target: [{ start: BAR + PPQ }] });
    const late = transferRegion(source, rollPart([]), drop(0, 7 * BAR));
    expect(late).toMatchObject({ target: [{ start: 6 * BAR, duration: 2 * BAR }] });
  });

  it("carries a patternless Euclidean region's sequencer as copyRegion takes it", () => {
    const euclid = { ...DEFAULT_EUCLIDEAN_CONFIG, kind: 'euclidean' as const, note: 60, hold: 1 };
    const source: LanePart = {
      regions: [{ start: 0, duration: BAR }],
      sequencer: { ...euclid, rotate: 3 },
    };
    const target: LanePart = { regions: [], sequencer: { ...euclid, rotate: 7 } };
    const moved = transferRegion(source, target, drop(0, BAR));
    expect(moved).toMatchObject({ source: [], index: 0 });
    expect(moved && 'target' in moved && moved.target[0]?.pattern).toEqual(
      copyRegion(source, 0)?.pattern,
    );
  });

  it('overwrites what it lands on: covered goes, overlapped is trimmed, landed inside is cut in two', () => {
    const source = rollPart([held(0, BAR, note(0, 60))]);
    const outer = note(0, 67);
    const inside = transferRegion(source, rollPart([held(0, 4 * BAR, outer)]), drop(0, 2 * BAR));
    expect(inside).toMatchObject({
      target: [held(0, 2 * BAR, outer), held(2 * BAR, BAR, note(0, 60)), held(3 * BAR, BAR, outer)],
      index: 1,
    });
    const lane = [held(0, BAR, note(0, 62)), held(BAR, 2 * BAR, note(0, 65))];
    const over = transferRegion(source, rollPart(lane), drop(0, 0));
    expect(over).toMatchObject({
      target: [{ start: 0, duration: BAR, pattern: note(0, 60) }, lane[1]],
    });
    const trim = transferRegion(source, rollPart(lane), drop(0, 2 * BAR));
    expect(trim).toMatchObject({
      target: [lane[0], { start: BAR, duration: BAR }, { start: 2 * BAR }],
    });
  });

  it("fits an empty roll's loop where the drop trims it", () => {
    const empty = held(0, 4 * BAR, { kind: 'roll', loopTicks: 4 * BAR, notes: [] });
    const placed = transferRegion(
      rollPart([held(0, BAR, note(0, 60))]),
      rollPart([empty]),
      drop(0, 3 * BAR),
    );
    expect(placed).toMatchObject({
      target: [{ duration: 3 * BAR, pattern: { loopTicks: 3 * BAR } }, {}],
    });
  });

  it("is refused onto another kind in Paste's words, and with no such region is null", () => {
    const grid: LanePart = { regions: [], sequencer: { ...DEFAULT_GRID_CONFIG, kind: 'grid' } };
    const refused = transferRegion(rollPart([a]), grid, drop(0, 0));
    const clip = copyRegion(rollPart([a]), 0);
    expect(refused).toEqual(clip && pasteRegion(grid, clip, 0, SONG));
    expect(refused).toHaveProperty('refused');
    expect(transferRegion(rollPart([a]), rollPart([]), drop(3, 0))).toBeNull();
  });
});

describe('a drop read from the release, not the last move', () => {
  const a = held(0, BAR, note(0, 60));
  const source = rollPart([a]);
  const press = { index: 0, pressTick: PPQ };
  const song = { songTicks: SONG, bar: BAR };
  const keys = (k: Partial<DragKeys> = {}): DragKeys => ({
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...k,
  });
  const releaseWith = (k: DragKeys, tick = 2 * BAR + PPQ) => {
    const drop = regionDropAt(source, press, { tick, ...dragModifiers(k) }, song);
    return drop && transferRegion(source, rollPart([]), drop);
  };

  it('Ctrl held on the last move but let go before pointer-up moves the region', () => {
    expect(releaseWith(keys({ ctrlKey: true }))).toMatchObject({ source: [a] });
    expect(releaseWith(keys())).toMatchObject({ source: [], target: [{ start: 2 * BAR }] });
  });

  it('Cmd pressed only at pointer-up copies, leaving the source', () => {
    expect(releaseWith(keys({ metaKey: true }))).toMatchObject({
      source: [a],
      target: [{ ...a, start: 2 * BAR }],
    });
  });

  it("Shift at pointer-up snaps to the region's step, not the bar", () => {
    const off = 2 * BAR + 2 * PPQ;
    expect(releaseWith(keys(), off)).toMatchObject({ target: [{ start: 2 * BAR }] });
    expect(releaseWith(keys({ shiftKey: true }), off)).toMatchObject({
      target: [{ start: 2 * BAR + PPQ }],
    });
  });
});
