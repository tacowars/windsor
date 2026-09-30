/**
 * The Parametric EQ curve's rules (windsor#199 decision 4): where each type's
 * point sits, which point a press takes, and what a drag, the wheel, a
 * double-click and each key do to the spec, with the fine and Alt modifiers.
 */
import { describe, expect, it } from 'vitest';

import type { EqBand, EqSpec } from '@windsor/engine';
import { DEFAULT_EQ, EQ_BOUNDS, EQ_DSP, eqResponseDb } from '@windsor/engine';
import {
  dbOfY,
  doubleClick,
  dragBand,
  eqPlot,
  freqOfX,
  hasQ,
  hitBand,
  keyEdit,
  pointAt,
  pointDb,
  soloBand,
  wheelBand,
  WHEEL_DELTA_MODE,
  wheelContinues,
  wheelPixels,
  withBand,
  xOfFreq,
  yOfDb,
} from './eqCurveModel';
import { EQ_GESTURE, EQ_PLOT } from './eqTables';

const RATE = 48000;
const PLOT = eqPlot(12);
const WIDE = eqPlot(24);

/** DEFAULT_EQ with band `index` replaced by `band`'s fields over the default's. */
function specWith(index: number, band: Partial<EqBand>, rest: Partial<EqSpec> = {}): EqSpec {
  return withBand({ ...DEFAULT_EQ, ...rest }, index, { ...DEFAULT_EQ.bands[index]!, ...band });
}

const bell = (fields: Partial<EqBand> = {}): EqBand => ({
  on: true,
  type: 'bell',
  slope: 12,
  freq: 1000,
  gain: 0,
  q: 1,
  ...fields,
});

/** A drag of `band` from the middle of the plot by (dx, dy). */
function drag(
  band: EqBand,
  [dx, dy]: readonly [number, number],
  o: { scale?: number; fine?: boolean; alt?: boolean } = {},
): EqBand {
  const start = { band, scale: o.scale ?? 1, x: 100, y: 80 };
  return dragBand(
    start,
    { x: 100 + dx, y: 80 + dy, fine: o.fine ?? false, alt: o.alt ?? false },
    PLOT,
  );
}

/** The px of one octave across the plot. */
const OCTAVE_PX = xOfFreq(2000, PLOT) - xOfFreq(1000, PLOT);

describe('the plot', () => {
  it('spans 10 Hz – 22 kHz in log frequency across its width', () => {
    expect(xOfFreq(EQ_BOUNDS.freq[0], PLOT)).toBe(0);
    expect(xOfFreq(EQ_BOUNDS.freq[1], PLOT)).toBeCloseTo(EQ_PLOT.width, 9);
    expect(freqOfX(xOfFreq(1234, PLOT), PLOT)).toBeCloseTo(1234, 6);
    expect(xOfFreq(400, PLOT) - xOfFreq(200, PLOT)).toBeCloseTo(OCTAVE_PX, 9);
  });

  it('puts 0 dB in the middle and ± the range at the pad, in either range', () => {
    expect(yOfDb(0, PLOT)).toBe(EQ_PLOT.height / 2);
    expect(yOfDb(12, PLOT)).toBe(EQ_PLOT.pad);
    expect(yOfDb(-24, WIDE)).toBe(EQ_PLOT.height - EQ_PLOT.pad);
    expect(dbOfY(yOfDb(-7.5, WIDE), WIDE)).toBeCloseTo(-7.5, 9);
  });
});

describe('where a point sits', () => {
  it('puts a bell or shelf at its gain times Scale', () => {
    for (const type of ['bell', 'lowshelf', 'highshelf'] as const) {
      expect(pointDb(specWith(2, { type, gain: 6 }, { scale: 0.5 }), 2, RATE), type).toBe(3);
    }
  });

  it('puts a notch and a 6 dB cut on 0 dB, whatever their gain or Q', () => {
    expect(pointDb(specWith(2, { type: 'notch', gain: 9, q: 8 }), 2, RATE)).toBe(0);
    expect(pointDb(specWith(0, { slope: 6, q: 10 }), 0, RATE)).toBe(0);
    expect(pointDb(specWith(7, { slope: 6, on: true }), 7, RATE)).toBe(0);
  });

  it("puts a 12/24/48 cut at the engine's response at its corner, on or off", () => {
    expect(pointDb(specWith(0, { on: false }), 0, RATE)).toBeCloseTo(-3.01, 1);
    for (const slope of [12, 24, 48] as const) {
      for (const [index, q] of [
        [0, 0.71],
        [7, 4],
      ] as const) {
        const spec = specWith(index, { slope, q });
        const freq = spec.bands[index]!.freq;
        const engine = eqResponseDb(soloBand(spec, index), [freq], RATE, new Float64Array(1))[0];
        expect(pointDb(spec, index, RATE), `${slope} ${index}`).toBe(engine);
      }
    }
    // More Q lifts a resonant cut's point above the corner's −3 dB.
    expect(pointDb(specWith(0, { q: 4 }), 0, RATE)).toBeGreaterThan(6);
  });

  it('reads a cut stored past the plot at the edge it is drawn at and designed at', () => {
    const rate = 32000;
    const plot = eqPlot(12, rate);
    const edge = rate * EQ_DSP.maxFrequencyRatio;
    const spec = specWith(7, { on: true, slope: 24, freq: 20000, q: 4 });
    const solo = soloBand(spec, 7);
    const atEdge = eqResponseDb(solo, [edge], rate, new Float64Array(1))[0]!;
    const atStored = eqResponseDb(solo, [20000], rate, new Float64Array(1))[0]!;
    expect(atEdge).not.toBeCloseTo(atStored, 1);
    expect(pointDb(spec, 7, rate)).toBe(atEdge);
    const at = pointAt(spec, 7, plot, rate);
    expect(at.x).toBe(EQ_PLOT.width - EQ_PLOT.pointRadius);
    expect(at.y).toBe(yOfDb(atEdge, plot));
  });

  it('draws only that band, on, with no output gain, for its own curve', () => {
    const solo = soloBand({ ...DEFAULT_EQ, enabled: false, output: 6 }, 7);
    expect(solo.bands.map((band) => band.on)).toEqual([...Array(7).fill(false), true]);
    expect([solo.enabled, solo.output]).toEqual([true, 0]);
  });

  it('clamps every point inside the plot by its radius', () => {
    const r = EQ_PLOT.pointRadius;
    const loud = specWith(2, { freq: EQ_BOUNDS.freq[0], gain: 24 });
    expect(pointAt(loud, 2, PLOT, RATE)).toEqual({ x: r, y: r });
    const low = specWith(2, { freq: EQ_BOUNDS.freq[1], gain: -24 });
    expect(pointAt(low, 2, PLOT, RATE)).toEqual({ x: EQ_PLOT.width - r, y: EQ_PLOT.height - r });
    expect(pointAt(low, 2, WIDE, RATE).y).toBe(EQ_PLOT.height - EQ_PLOT.pad);
  });
});

describe('which point a press takes', () => {
  it('takes the nearest point within the hit radius, else none', () => {
    const at = pointAt(DEFAULT_EQ, 3, PLOT, RATE);
    expect(hitBand(DEFAULT_EQ, at, PLOT, RATE)).toBe(3);
    expect(hitBand(DEFAULT_EQ, { x: at.x + EQ_PLOT.hitRadius - 1, y: at.y }, PLOT, RATE)).toBe(3);
    expect(hitBand(DEFAULT_EQ, { x: at.x, y: at.y + EQ_PLOT.hitRadius + 1 }, PLOT, RATE)).toBe(-1);
  });
});

describe('a drag', () => {
  it('moves frequency in log along x: an octave of px doubles it', () => {
    expect(drag(bell(), [OCTAVE_PX, 0]).freq).toBeCloseTo(2000, 6);
    expect(drag(bell(), [-OCTAVE_PX, 0]).freq).toBeCloseTo(500, 6);
  });

  it("moves a bell's or shelf's gain along y, as drawn: divided by Scale", () => {
    const up = -(EQ_PLOT.height / 2 - EQ_PLOT.pad) / 2;
    expect(drag(bell(), [0, up]).gain).toBeCloseTo(6, 9);
    expect(drag(bell({ type: 'lowshelf' }), [0, up], { scale: 0.5 }).gain).toBeCloseTo(12, 9);
    expect(drag(bell({ gain: 3 }), [0, up], { scale: 0 }).gain).toBe(3);
    expect(drag(bell(), [0, -1000]).gain).toBe(EQ_BOUNDS.gain[1]);
  });

  it("moves a 12/24/48 cut's Q along y, and leaves its gain", () => {
    const cut: EqBand = { ...bell({ gain: 2 }), type: 'lowcut', q: 1 };
    const up = drag(cut, [0, -EQ_GESTURE.qDragPx]);
    expect(up.q).toBeCloseTo(Math.E, 9);
    expect(up.gain).toBe(2);
    expect(drag({ ...cut, type: 'highcut', slope: 48 }, [0, 1000]).q).toBe(EQ_BOUNDS.q[0]);
  });

  it('moves a notch or a 6 dB cut along x only', () => {
    for (const band of [bell({ type: 'notch', q: 8 }), { ...bell(), type: 'highcut', slope: 6 }]) {
      const moved = drag(band as EqBand, [OCTAVE_PX, -60]);
      expect(moved.freq, band.type).toBeCloseTo(2000, 6);
      expect([moved.gain, moved.q], band.type).toEqual([band.gain, band.q]);
    }
  });

  it('with Alt, moves Q along y for any type and ignores x', () => {
    const moved = drag(bell({ gain: 4 }), [OCTAVE_PX, -EQ_GESTURE.qDragPx], { alt: true });
    expect(moved.q).toBeCloseTo(Math.E, 9);
    expect([moved.freq, moved.gain]).toEqual([1000, 4]);
  });

  it('with Shift, takes a fifth of every step', () => {
    const fine = drag(bell(), [OCTAVE_PX, -(EQ_PLOT.height / 2 - EQ_PLOT.pad)], { fine: true });
    expect(fine.freq).toBeCloseTo(1000 * 2 ** EQ_GESTURE.fine, 6);
    expect(fine.gain).toBeCloseTo(12 * EQ_GESTURE.fine, 9);
    const q = drag(bell(), [0, -EQ_GESTURE.qDragPx], { fine: true, alt: true }).q;
    expect(q).toBeCloseTo(Math.exp(EQ_GESTURE.fine), 9);
  });

  it('turns a band that is off on', () => {
    expect(drag(bell({ on: false }), [1, 0]).on).toBe(true);
    expect(drag(bell({ on: false }), [0, 1], { alt: true }).on).toBe(true);
  });

  it('holds frequency in range', () => {
    expect(drag(bell(), [-1000, 0]).freq).toBe(EQ_BOUNDS.freq[0]);
    expect(drag(bell(), [1000, 0]).freq).toBe(EQ_BOUNDS.freq[1]);
  });
});

describe('the wheel over a point', () => {
  it('raises Q on a wheel away, lowers it towards, and Shift is finer', () => {
    expect(wheelBand(bell(), -EQ_GESTURE.wheelPx, false).q).toBeCloseTo(Math.E, 9);
    expect(wheelBand(bell(), EQ_GESTURE.wheelPx, false).q).toBeCloseTo(1 / Math.E, 9);
    expect(wheelBand(bell(), -EQ_GESTURE.wheelFinePx, true).q).toBeCloseTo(Math.E, 9);
    expect(wheelBand(bell({ q: 17 }), -1e4, false).q).toBe(EQ_BOUNDS.q[1]);
  });

  it('reads a delta in px whatever unit the device reports', () => {
    expect(wheelPixels(-100, WHEEL_DELTA_MODE.pixel, EQ_PLOT.height)).toBe(-100);
    expect(wheelPixels(3, WHEEL_DELTA_MODE.line, EQ_PLOT.height)).toBeCloseTo(100, 9);
    expect(wheelPixels(3, WHEEL_DELTA_MODE.line, EQ_PLOT.height)).toBe(3 * EQ_GESTURE.wheelLinePx);
    expect(wheelPixels(-1, WHEEL_DELTA_MODE.page, EQ_PLOT.height)).toBe(-EQ_PLOT.height);
  });

  it('turns Q alike for a notch of 100 px and a notch of 3 lines', () => {
    const lines = wheelPixels(-3, WHEEL_DELTA_MODE.line, EQ_PLOT.height);
    expect(wheelBand(bell(), lines, false).q).toBeCloseTo(wheelBand(bell(), -100, false).q, 9);
  });

  it('continues the open Q step only on the band its ticks turned', () => {
    expect(wheelContinues(-1, 0)).toBe(false);
    expect(wheelContinues(2, 2)).toBe(true);
    expect(wheelContinues(2, 3)).toBe(false);
  });
});

describe('a double-click', () => {
  it('on a point puts its gain back to 0 dB and leaves the rest', () => {
    const spec = specWith(4, { gain: 7, q: 3 });
    const done = doubleClick(spec, pointAt(spec, 4, PLOT, RATE), PLOT, RATE);
    expect(done.kind).toBe('reset');
    if (done.kind === 'full') return;
    expect(done.band).toBe(4);
    expect(done.spec.bands[4]).toEqual({ ...spec.bands[4], gain: 0 });
    expect(done.spec.bands.filter((_, i) => i !== 4)).toEqual(spec.bands.filter((_, i) => i !== 4));
  });

  it('on empty curve makes the first free band a Bell at Q 1 where the click was', () => {
    const click = { x: xOfFreq(440, PLOT), y: yOfDb(6, PLOT) };
    const done = doubleClick(DEFAULT_EQ, click, PLOT, RATE);
    expect(done).toMatchObject({ kind: 'add', band: 0 });
    if (done.kind === 'full') return;
    const added = done.spec.bands[0]!;
    expect(added).toMatchObject({ on: true, type: 'bell', q: EQ_GESTURE.addedBellQ });
    expect(added.freq).toBeCloseTo(440, 6);
    expect(added.gain).toBeCloseTo(6, 9);
    const at = pointAt(done.spec, 0, PLOT, RATE);
    expect(at.x).toBeCloseTo(click.x, 6);
    expect(at.y).toBeCloseTo(click.y, 6);
  });

  it('stores the clicked gain divided by Scale, clamped, so the point lands on the click', () => {
    const click = { x: xOfFreq(3000, WIDE), y: yOfDb(6, WIDE) };
    const half = doubleClick({ ...DEFAULT_EQ, scale: 0.5 }, click, WIDE, RATE);
    if (half.kind === 'full') throw new Error('no band was free');
    expect(half.spec.bands[half.band]!.gain).toBeCloseTo(12, 9);
    expect(pointAt(half.spec, half.band, WIDE, RATE).y).toBeCloseTo(click.y, 6);
    const quarter = doubleClick({ ...DEFAULT_EQ, scale: 0.2 }, click, WIDE, RATE);
    if (quarter.kind === 'full') throw new Error('no band was free');
    expect(quarter.spec.bands[quarter.band]!.gain).toBe(EQ_BOUNDS.gain[1]);
    const none = doubleClick({ ...DEFAULT_EQ, scale: 0 }, click, WIDE, RATE);
    if (none.kind === 'full') throw new Error('no band was free');
    expect(none.spec.bands[none.band]!.gain).toBe(0);
  });

  it('takes the next free band once the first is on', () => {
    const spec = specWith(0, { on: true });
    const done = doubleClick(spec, { x: xOfFreq(1500, PLOT), y: 20 }, PLOT, RATE);
    expect(done).toMatchObject({ kind: 'add', band: 7 });
  });

  it('with all eight bands on, adds nothing', () => {
    const spec = { ...DEFAULT_EQ, bands: DEFAULT_EQ.bands.map((band) => ({ ...band, on: true })) };
    expect(doubleClick(spec, { x: xOfFreq(1500, PLOT), y: 20 }, PLOT, RATE)).toEqual({
      kind: 'full',
    });
  });
});

describe('the keys', () => {
  const key = (k: string, mods: { alt?: boolean; shift?: boolean } = {}) => ({
    key: k,
    alt: mods.alt ?? false,
    shift: mods.shift ?? false,
  });
  const spec = specWith(3, { freq: 1000, gain: 2, q: 1 });
  const edited = (k: string, mods = {}): EqBand => {
    const done = keyEdit(spec, 3, key(k, mods), PLOT);
    if (!done || !('band' in done)) throw new Error(`${k} edited nothing`);
    return done.band;
  };

  it('select band 1 to 8 with the digits, and nothing else', () => {
    for (let n = 1; n <= 8; n++)
      expect(keyEdit(spec, 3, key(String(n)), PLOT)).toEqual({ select: n - 1 });
    expect(keyEdit(spec, 3, key('9'), PLOT)).toBeNull();
    expect(keyEdit(spec, 3, key('0'), PLOT)).toBeNull();
    expect(keyEdit(spec, 3, key('a'), PLOT)).toBeNull();
  });

  it('move frequency a semitone and gain half a dB with the arrows', () => {
    expect(edited('ArrowRight').freq).toBeCloseTo(1000 * 2 ** (1 / 12), 9);
    expect(edited('ArrowLeft').freq).toBeCloseTo(1000 * 2 ** (-1 / 12), 9);
    expect(edited('ArrowUp').gain).toBe(2.5);
    expect(edited('ArrowDown').gain).toBe(1.5);
    expect(edited('ArrowUp').freq).toBe(1000);
  });

  it('leave a cut or a notch at its gain', () => {
    const cut = specWith(0, { gain: 2 });
    const done = keyEdit(cut, 0, key('ArrowUp'), PLOT);
    expect(done && 'band' in done && done.band.gain).toBe(2);
  });

  it('move Q with Alt and ↑ or ↓, and Alt with ← or → does nothing', () => {
    expect(edited('ArrowUp', { alt: true }).q).toBeCloseTo(Math.exp(EQ_GESTURE.keyQLog), 9);
    expect(edited('ArrowDown', { alt: true }).q).toBeCloseTo(Math.exp(-EQ_GESTURE.keyQLog), 9);
    expect(edited('ArrowUp', { alt: true }).gain).toBe(2);
    expect(keyEdit(spec, 3, key('ArrowLeft', { alt: true }), PLOT)).toBeNull();
  });

  it('take a fifth of each step with Shift', () => {
    expect(edited('ArrowRight', { shift: true }).freq).toBeCloseTo(1000 * 2 ** (0.2 / 12), 9);
    expect(edited('ArrowUp', { shift: true }).gain).toBeCloseTo(2.1, 9);
    expect(edited('ArrowUp', { shift: true, alt: true }).q).toBeCloseTo(Math.exp(0.02), 9);
  });
});

describe('a band', () => {
  it('has a Q unless it is a 6 dB cut', () => {
    expect(hasQ(bell())).toBe(true);
    expect(hasQ({ ...bell(), type: 'lowcut', slope: 6 })).toBe(false);
    expect(hasQ({ ...bell(), type: 'notch', slope: 6 })).toBe(true);
  });

  it('is replaced in a new spec, the old one untouched', () => {
    const before = structuredClone(DEFAULT_EQ);
    const next = withBand(DEFAULT_EQ, 2, bell());
    expect(next.bands[2]).toEqual(bell());
    expect(DEFAULT_EQ).toEqual(before);
  });
});
