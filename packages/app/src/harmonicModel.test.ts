/**
 * The User-wave bars (#511): what a stroke and the count switch write, the
 * preview cycle, and that the result survives the song export — the path a
 * stroke takes is `ops[i].userPartials` → `pushPatch` → the document's
 * `patches` merge (`commitPatch` in partsTab), which is modelled here without
 * a browser the way presetBrowser.test.ts does.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from '@windsor/engine/__fixtures__/fullArrangement';
import { WAVE, makePatch } from '@windsor/engine';
import { DocumentModel } from './documentModel';
import {
  PREVIEW_POINTS,
  countFor,
  drawablePartials,
  paintStroke,
  pointToBar,
  resizePartials,
  seedPartials,
  waveCycle,
} from './harmonicModel';

describe('harmonic bars', () => {
  it('seeds a pure fundamental', () => {
    expect(seedPartials()).toEqual([1, ...Array(15).fill(0)]);
    expect(seedPartials(32)).toHaveLength(32);
  });

  it('picks the smallest count that shows the whole array', () => {
    expect(countFor(null)).toBe(16);
    expect(countFor([1, 0.5])).toBe(16);
    expect(countFor(Array(17).fill(0))).toBe(32);
    expect(countFor(Array(64).fill(0))).toBe(64);
    expect(countFor(Array(200).fill(0))).toBe(64);
  });

  it('resizes by truncating or padding with silence', () => {
    const drawn = [1, 0.5, 0.25, ...Array(29).fill(0.1)];
    expect(resizePartials(drawn, 16)).toEqual(drawn.slice(0, 16));
    const grown = resizePartials([1, 0.5], 32);
    expect(grown).toHaveLength(32);
    expect(grown.slice(0, 2)).toEqual([1, 0.5]);
    expect(grown.slice(2).every((v) => v === 0)).toBe(true);
    expect(resizePartials(null, 16)).toEqual(seedPartials(16));
  });

  it('pads a short stored array so every shown bar can be drawn, and keeps long ones whole', () => {
    const silk = [1, 0.28, 0.12, 0.06, 0.03];
    const padded = drawablePartials(silk);
    expect(padded).toHaveLength(16);
    expect(padded.slice(0, 5)).toEqual(silk);
    expect(padded).not.toBe(silk);
    expect(drawablePartials(null)).toEqual(seedPartials());
    const long = Array(80).fill(0.5);
    expect(drawablePartials(long)).toEqual(long);
    const painted = drawablePartials(silk);
    paintStroke(painted, null, { index: 12, value: 0.6 });
    expect(painted[12]).toBe(0.6);
  });

  it('maps a pointer to a bar and a height, clamped to the canvas', () => {
    const size = { width: 160, height: 50 };
    expect(pointToBar({ x: 0, y: 50 }, size, 16)).toEqual({ index: 0, value: 0 });
    expect(pointToBar({ x: 159, y: 0 }, size, 16)).toEqual({ index: 15, value: 1 });
    expect(pointToBar({ x: 25, y: 25 }, size, 16)).toEqual({ index: 2, value: 0.5 });
    expect(pointToBar({ x: -10, y: 90 }, size, 16)).toEqual({ index: 0, value: 0 });
    expect(pointToBar({ x: 500, y: -5 }, size, 16)).toEqual({ index: 15, value: 1 });
  });

  it('fills every bar a fast drag skips, in either direction', () => {
    const right = seedPartials();
    paintStroke(right, { index: 2, value: 0 }, { index: 6, value: 1 });
    expect(right.slice(2, 7)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const left = seedPartials();
    paintStroke(left, { index: 6, value: 1 }, { index: 2, value: 0 });
    expect(left.slice(2, 7)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const tap = seedPartials();
    paintStroke(tap, null, { index: 3, value: 0.4 });
    expect(tap[3]).toBe(0.4);
    expect(tap.filter((v) => v !== 0)).toEqual([1, 0.4]);
  });

  it('draws a peak-normalised cycle, and silence as silence', () => {
    const sine = waveCycle([1], 8);
    expect(Math.max(...sine.map(Math.abs))).toBeCloseTo(1, 6);
    expect(sine[2]).toBeCloseTo(1, 6);
    const odd = waveCycle([1, 0, 1 / 3], 64);
    expect(Math.max(...odd.map(Math.abs))).toBeCloseTo(1, 6);
    expect(odd[16]).not.toBeCloseTo(1, 2);
    expect([...waveCycle([0, 0], 8)].every((v) => v === 0)).toBe(true);
  });

  it('previews the highest harmonics without aliasing them away', () => {
    const top = Array(64).fill(0);
    top[0] = 1;
    top[31] = 1;
    top[63] = 1;
    const withTop = waveCycle(top, PREVIEW_POINTS);
    const sine = waveCycle([1], PREVIEW_POINTS);
    const deviation = withTop.reduce((m, v, i) => Math.max(m, Math.abs(v - (sine[i] ?? 0))), 0);
    expect(deviation).toBeGreaterThan(0.1);
    // Every offered harmonic sits below the preview's Nyquist.
    expect(PREVIEW_POINTS / 2).toBeGreaterThan(top.length);
  });
});

describe('a drawn User wave in the song', () => {
  const withUserWave = (partials: number[]): ReturnType<typeof makePatch> =>
    makePatch({ ops: [{ wave: WAVE.USER, userPartials: partials }] });

  it('round-trips through export and import, and a smaller count replaces the array', () => {
    const model = new DocumentModel(FULL_ARRANGEMENT);
    const id = 'user-wave-test';
    const drawn = resizePartials([1, 0.5, 0.25], 32);
    model.merge({ patches: { [id]: withUserWave(drawn) } });
    const imported = new DocumentModel(JSON.parse(model.toJson()));
    expect(imported.doc.patches?.[id]?.ops[0]?.userPartials).toEqual(drawn);
    expect(imported.doc.patches?.[id]?.ops[0]?.wave).toBe(WAVE.USER);

    const fewer = resizePartials(drawn, 16);
    imported.merge({ patches: { [id]: withUserWave(fewer) } });
    expect(imported.doc.patches?.[id]?.ops[0]?.userPartials).toEqual(fewer);
  });
});
