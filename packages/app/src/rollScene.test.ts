/**
 * The Roll's scene lays out its rows from the stored notes and the pitches
 * Rec holds (windsor#667): a held note sits in the row it will have once
 * written.
 */
import type { Harmony, RollNote } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { heldOffRows, rollScene, type SceneInput } from './rollScene';

const HARMONY: Harmony = { root: 0, scale: 'major', events: [] };
const C = 60;
const E = 64;
const F_SHARP = 66;

const note = (pitch: number): RollNote => ({ tick: 0, ticks: 24, pitch });

const input = (over: Partial<SceneInput>): SceneInput => ({
  notes: [note(C), note(E)],
  loopTicks: 384,
  regionStart: 0,
  regionTicks: 384,
  barTicks: 384,
  snapTicks: 24,
  harmony: HARMONY,
  songTicks: 768,
  keys: '12',
  fold: true,
  rowPx: 12,
  panePx: 240,
  beatPx: 24,
  ...over,
});

const pitches = (scene: ReturnType<typeof rollScene>): number[] =>
  scene.rows.rows.map((row) => row.pitch);

describe('rollScene with held pitches', () => {
  it('under Fold, gives a held pitch the row it has once written', () => {
    const before = rollScene(input({}));
    expect(heldOffRows(before, [F_SHARP])).toBe(true);
    const held = rollScene(input({ held: [F_SHARP] }));
    const written = rollScene(input({ notes: [note(C), note(E), note(F_SHARP)] }));
    expect(pitches(held)).toEqual([F_SHARP, E, C]);
    expect(held.rows).toEqual(written.rows);
    expect(heldOffRows(held, [F_SHARP])).toBe(false);
  });

  it('under Scale, gives an out-of-scale held pitch its thin sliver, as once written', () => {
    const scale = { keys: 'scale' as const, fold: false };
    const held = rollScene(input({ ...scale, held: [F_SHARP] }));
    const written = rollScene(input({ ...scale, notes: [note(C), note(E), note(F_SHARP)] }));
    expect(held.rowByPitch.get(F_SHARP)?.thin).toBe(true);
    expect(held.rows).toEqual(written.rows);
  });

  it('lays out the rows as before for a held pitch already in them', () => {
    expect(heldOffRows(rollScene(input({})), [E])).toBe(false);
    expect(rollScene(input({ held: [E] })).rows).toEqual(rollScene(input({})).rows);
  });
});
