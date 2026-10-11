/**
 * The shown envelope's geometry over the note pane (windsor#707 decision 6):
 * a fixture envelope's points and bends land at the right x and y on the
 * −1..1 scale with 0 on the middle line, the curve repeats over the region
 * with every pass past the loop a ghost, a point past the loop is silent,
 * and an envelope with no points is its flat 0 line.
 */
import { describe, expect, it } from 'vitest';

import type { RollEnvelopePoint } from '@windsor/engine';
import { TICKS_PER_BAR, bendCurve } from '@windsor/engine';
import { envelopeGeometry, envelopePasses } from './rollEnvelopeGeometry';
import { AUTOMATION_DRAWING } from './songAutomationTables';

const BAR = TICKS_PER_BAR;
const PAD = AUTOMATION_DRAWING.padPx;
/** 2 px per tick, a 2-bar loop in a 4-bar region, a pane 112 px high: 100 px between the pads. */
const FRAME = { heightPx: 2 * PAD + 100, pxPerTick: 2, loopTicks: 2 * BAR, regionTicks: 4 * BAR };
const POINTS: RollEnvelopePoint[] = [
  { tick: 0, value: -0.5, bend: 0.5 },
  { tick: BAR, value: 0.5, bend: 0 },
  { tick: (3 * BAR) / 2, value: 0, bend: 0 },
];

/** The y a value draws at: +1 at the top pad, −1 at the bottom one, 0 in the middle. */
const yOf = (value: number): number => PAD + (1 - (value + 1) / 2) * 100;

/** The path's points, as [x, y] pairs. */
const coords = (path: string): number[][] =>
  [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("the envelope's geometry (windsor#707)", () => {
  it('puts each point at its tick and value, 0 on the middle line', () => {
    const { curve, zeroY } = envelopeGeometry(POINTS, FRAME);
    expect(zeroY).toBe(PAD + 50);
    expect(curve.dots).toEqual([
      { x: 0, y: yOf(-0.5) },
      { x: 2 * BAR, y: yOf(0.5) },
      { x: 3 * BAR, y: yOf(0) },
    ]);
  });

  it('bends the first segment along the evaluator’s curve, at the right x and y', () => {
    const { curve } = envelopeGeometry(POINTS, FRAME);
    const line = coords(curve.line);
    // Halfway through the bent segment, the bend's own curve, in display space.
    const mid = line.find(([x]) => x === BAR);
    const display = 0.25 + 0.5 * bendCurve(0.5, 0.5, 0.5);
    expect(mid?.[1]).toBeCloseTo(PAD + (1 - display) * 100, 1);
    expect(display).not.toBeCloseTo(0.5, 2);
    // The straight segments are one line each, and the last value holds to the loop's end.
    expect(line.at(-1)).toEqual([2 * 2 * BAR, yOf(0)]);
  });

  it('draws the loop once live and ghosts every repeat over the region', () => {
    expect(envelopePasses(FRAME)).toEqual([
      { x: 0, width: 4 * BAR, ghost: false },
      { x: 4 * BAR, width: 4 * BAR, ghost: true },
    ]);
    const short = { ...FRAME, loopTicks: 3 * BAR };
    expect(envelopePasses(short)).toEqual([
      { x: 0, width: 6 * BAR, ghost: false },
      { x: 6 * BAR, width: 2 * BAR, ghost: true },
    ]);
  });

  it('keeps a point past a shrunk loop silent: no dot, the last value heard held', () => {
    const shrunk = { ...FRAME, loopTicks: BAR + 1 };
    const { curve } = envelopeGeometry(POINTS, shrunk);
    expect(curve.dots.map((d) => d.x)).toEqual([0, 2 * BAR]);
    expect(coords(curve.line).at(-1)).toEqual([2 * (BAR + 1), yOf(0.5)]);
  });

  it('draws an envelope with no points as its flat 0 line, with no dots', () => {
    const { curve } = envelopeGeometry([], FRAME);
    expect(curve.dots).toEqual([]);
    expect(new Set(coords(curve.line).map(([, y]) => y))).toEqual(new Set([yOf(0)]));
  });
});
