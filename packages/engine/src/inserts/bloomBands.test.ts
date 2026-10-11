/**
 * bloom's Low, High and Focus (`worklet/bloom/bloomBands.ts`), through the
 * shipped bundle: the range's edges at the chosen notes, masked bands silent
 * and costing nothing, a band leaving the range without a click; Focus's
 * level calibration, its onset (group delay) scaling, a glide without a
 * click, and focus 1 restoring the default's coefficients to the bit.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { describe, expect, it } from 'vitest';
import { bloomRig, lineDb, peak, renderBloom, tone } from '../__fixtures__/bloomHarness';
import type { BloomRender } from '../__fixtures__/bloomHarness';

const RATE = 48000;
const QUANTUM = 128;
const WET = { mix: 1 } as const;
/** −12 dBFS peak. */
const LEVEL = 0.25;
/** The target layer at −12 dBFS: E1 −3.3 dB re the input. */
const E1_DB = -3.3;
/** Focus keeps the on-note level within this. */
const LEVEL_DB = 0.5;
/** Past the onset's transient, s·rate. */
const SETTLED = 0.3 * 48000;
/** The onset's RMS window, s, and the share of the settled RMS it is reached at. */
const ONSET_WINDOW = 0.01;
const ONSET_SHARE = 0.5;
/** A control move may raise the largest sample-to-sample step by at most this factor over the steady layer's. */
const STEP_FACTOR = 1.1;

const hzOf = (note: number): number => 440 * 2 ** ((note - 69) / 12);
const seconds = (s: number): number => Math.round(s * RATE);

/** E1 of `hz` over the settled [0.6, 1.6) s, in dB re `LEVEL`. */
const e1 = (render: BloomRender, hz: number): number =>
  lineDb(render.left, { hz, rate: RATE, from: seconds(0.6), to: seconds(1.6), reference: LEVEL });

/** The largest |y[i] − y[i − 1]| over [from, to). */
function maxStep(y: Float32Array, from: number, to: number): number {
  let step = 0;
  for (let i = Math.max(1, from); i < to; i++) step = Math.max(step, Math.abs(y[i]! - y[i - 1]!));
  return step;
}

/**
 * When the layer's RMS over a sliding `ONSET_WINDOW` first reaches half its
 * settled RMS (from 1 s on), in ms at the window's centre. An RMS rather than
 * the first sample over half the peak: the onset's many-band splatter makes
 * single peaks cross that line a few ms either way on a 0.1 dB change.
 */
function onsetMs(y: Float32Array): number {
  const window = seconds(ONSET_WINDOW);
  let settled = 0;
  for (let i = seconds(1); i < y.length; i++) settled += y[i]! * y[i]!;
  const line = (settled / (y.length - seconds(1))) * ONSET_SHARE * ONSET_SHARE * window;
  let energy = 0;
  for (let i = 0; i < y.length; i++) {
    energy += y[i]! * y[i]!;
    if (i >= window) energy -= y[i - window]! * y[i - window]!;
    if (i >= window - 1 && energy > line) return ((i + 1 - window / 2) / RATE) * 1000;
  }
  return NaN;
}

interface BandsInternals {
  bands: {
    idle: Uint8Array;
    enabled: Uint8Array;
    pole1Re: Float64Array;
    pole2Im: Float64Array;
    gainRe: Float64Array;
    gainIm: Float64Array;
  };
}

describe('Low and High', () => {
  const range = { ...WET, low: 57, high: 69 } as const;

  it.each([57, 63, 69])('note %i, inside A3…A4, sounds at the default level', (note) => {
    const out = renderBloom(range, { seconds: 1.6, source: tone(hzOf(note), LEVEL, RATE) });
    expect(Math.abs(e1(out, hzOf(note)) - E1_DB)).toBeLessThan(LEVEL_DB);
  });

  // A tone's hard start rings the bands near it for its first ~50 ms whatever the range (the
  // selection's own onset), so the settled note is what must be silent.
  it.each([56, 70, 41, 88])('note %i, outside A3…A4, generates nothing once settled', (note) => {
    const out = renderBloom(range, { seconds: 1.6, source: tone(hzOf(note), LEVEL, RATE) });
    expect(peak(out.left, SETTLED)).toBe(0);
  });

  it('takes Low and High in either order, and masked bands go idle (skipped)', () => {
    const rig = bloomRig({ ...WET, low: 69, high: 57 });
    const out = rig.render(seconds(1.6), tone(hzOf(60), LEVEL, RATE));
    expect(Math.abs(e1(out, hzOf(60)) - E1_DB)).toBeLessThan(LEVEL_DB);
    const { bands } = rig.processor.dsp as unknown as BandsInternals;
    const idle = [...bands.idle];
    expect(idle.filter((v) => v === 0)).toHaveLength(13);
    expect(idle.slice(57 - 41, 70 - 41).every((v) => v === 0)).toBe(true);
  });

  it('a sounding band leaving the range fades out without a click, then idles', () => {
    const change = seconds(1);
    const rig = bloomRig(WET);
    const out = rig.render(seconds(1.3), tone(220, LEVEL, RATE), {
      onBlock: (frame, params) => {
        if (frame === Math.round(change / QUANTUM) * QUANTUM) params.high![0] = 50;
      },
    });
    const steady = maxStep(out.left, seconds(0.6), change);
    expect(maxStep(out.left, change, out.left.length)).toBeLessThan(steady * STEP_FACTOR);
    expect(peak(out.left, change + seconds(0.05))).toBe(0);
    const { bands } = rig.processor.dsp as unknown as BandsInternals;
    expect(bands.idle[57 - 41]).toBe(1);
  });

  it('a band coming back into range sounds again, from rest', () => {
    const back = seconds(0.5);
    const out = renderBloom(
      { ...WET, high: 50 },
      {
        seconds: 1.6,
        source: tone(220, LEVEL, RATE),
        onBlock: (frame, params) => {
          if (frame === Math.round(back / QUANTUM) * QUANTUM) params.high![0] = 88;
        },
      },
    );
    expect(peak(out.left, SETTLED, back)).toBe(0);
    expect(Math.abs(e1(out, 220) - E1_DB)).toBeLessThan(LEVEL_DB);
  });
});

describe('Focus', () => {
  it.each([110, 220, 880])('keeps E1 of an on-note %i Hz sine calibrated at ×0.5, ×1, ×2', (hz) => {
    for (const focus of [0.5, 1, 2]) {
      const out = renderBloom({ ...WET, focus }, { seconds: 1.6, source: tone(hz, LEVEL, RATE) });
      expect(Math.abs(e1(out, hz) - E1_DB)).toBeLessThan(LEVEL_DB);
    }
  });

  it('speaks later when narrow and sooner when wide: the onset scales about as 1/focus', () => {
    // At 220 Hz bloom gives about 86, 49 and 11 ms.
    const onset = (focus: number): number =>
      onsetMs(
        renderBloom({ ...WET, focus }, { seconds: 1.6, source: tone(220, LEVEL, RATE) }).left,
      );
    const [narrow, unit, wide] = [onset(0.5), onset(1), onset(2)];
    expect(narrow / unit).toBeGreaterThan(1.6);
    expect(narrow / unit).toBeLessThan(2.4);
    expect(unit / wide).toBeGreaterThan(1.6);
  });

  it('glides ×0.5 → ×2 without a click', () => {
    const change = seconds(1);
    const out = renderBloom(
      { ...WET, focus: 0.5 },
      {
        seconds: 1.4,
        source: tone(220, LEVEL, RATE),
        onBlock: (frame, params) => {
          if (frame === Math.round(change / QUANTUM) * QUANTUM) params.focus![0] = 2;
        },
      },
    );
    const steady = maxStep(out.left, seconds(0.6), change);
    expect(maxStep(out.left, change, out.left.length)).toBeLessThan(steady * STEP_FACTOR);
  });

  it('back at ×1 restores the default coefficients to the bit', () => {
    const fresh = bloomRig({}).processor.dsp as unknown as BandsInternals;
    const rig = bloomRig({ focus: 1.7 });
    rig.render(seconds(0.1), tone(220, LEVEL, RATE));
    rig.params.focus![0] = 1;
    rig.render(seconds(0.5), tone(220, LEVEL, RATE));
    const moved = rig.processor.dsp as unknown as BandsInternals;
    expect(moved.bands.pole1Re).toEqual(fresh.bands.pole1Re);
    expect(moved.bands.pole2Im).toEqual(fresh.bands.pole2Im);
    expect(moved.bands.gainRe).toEqual(fresh.bands.gainRe);
    expect(moved.bands.gainIm).toEqual(fresh.bands.gainIm);
  });
});
