/**
 * The direct shape's edges and level (windsor#655, record
 * `2026-10-09-sync-direct-shape`), over the fields `voiceSyncShape.ts`
 * reads: each interval's polyBLEP sums against a brute-force walk of the
 * same path that finds every edge by scanning the wave, through a ratio
 * just below and through a whole number, a duty edge within a sample of a
 * reset, and a wrap in the same sample as a reset; and the level read off a
 * table of any length. The render is `synth/fmProcessorSyncShape.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { Voice } from './voice';
import { SYNC_BLEP_GAIN } from './fmConstants';
import { WAVE } from './waveIds';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { getMips } = await import('./waveTables');
const { VoiceSync } = await import('./voiceSync');
const { SHAPE_PULSE, SHAPE_SAW, SHAPE_SQUARE, beginSyncShapeBlock, syncShapeEdges } =
  await import('./voiceSyncShape');

const G = 0.8;

/** The shape at phase `p` in [0, 1), as the record writes it. */
function wave(kind: number, p: number, w: number): number {
  if (kind === SHAPE_SAW) return ((G * Math.PI) / 2) * (1 - 2 * p);
  if (kind === SHAPE_SQUARE) return p < 0.5 ? (G * Math.PI) / 4 : (-G * Math.PI) / 4;
  return p < 1 - w ? G * Math.PI * w : G * Math.PI * (w - 1);
}

/**
 * What an interval owes, found by walking it: the operator runs from `p0`
 * at `inc` a sample, restarting at phase 0 `d` of a sample before the next
 * sample (none for NaN). Every jump the wave makes over a step of the walk
 * larger than its slope could is an edge, located to the step; the reset is
 * one wherever it falls, however small its step.
 */
function walked(kind: number, p0: number, inc: number, d: number, w: number): [number, number] {
  const steps = 200_000;
  const resetAt = d === d ? 1 - d : 2;
  let hold = 0;
  let owe = 0;
  let last = wave(kind, p0, w);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const p = t < resetAt ? p0 + t * inc : (t - resetAt) * inc;
    const now = wave(kind, p - Math.floor(p), w);
    const h = now - last;
    const reset = t >= resetAt && t - 1 / steps < resetAt;
    if (Math.abs(h) > 0.05 || reset) {
      const dd = reset ? d : 1 - (t - 0.5 / steps);
      hold += h * dd * dd * SYNC_BLEP_GAIN;
      owe += h * (1 - dd) * (1 - dd) * SYNC_BLEP_GAIN;
    }
    last = now;
  }
  return [hold, owe];
}

/** What `syncShapeEdges` adds to operator A's held wave and owes its next, for one interval. */
function edges(kind: number, p0: number, inc: number, d: number, w = 1): [number, number] {
  const sync = new VoiceSync();
  const voice = {
    sync,
    phase: Float64Array.of(0, 0, 0, 0),
    phaseInc: Float64Array.of(inc, 0, 0, 0),
    width: Float32Array.of(w, 1, 1, 1),
  } as unknown as Voice;
  const sh = sync.shape;
  sh.direct = 1;
  sh.kind[0] = kind;
  sh.gain[0] = G;
  sh.prev[0] = p0;
  sh.reset[0] = d;
  syncShapeEdges(voice);
  expect(sh.reset[0]).toBeNaN();
  return [sync.held[0]!, sync.after[0]!];
}

const near = ([a, b]: [number, number], [x, y]: [number, number]): void => {
  expect(a).toBeCloseTo(x, 4);
  expect(b).toBeCloseTo(y, 4);
};

describe('syncShapeEdges', () => {
  it.each([
    { name: 'a Saw wrapping on its own', kind: SHAPE_SAW, p0: 0.97, inc: 0.05, d: NaN, w: 1 },
    { name: 'a Square falling at 0.5', kind: SHAPE_SQUARE, p0: 0.48, inc: 0.05, d: NaN, w: 1 },
    {
      name: 'a Pulse at duty 0.3 falling at 0.7',
      kind: SHAPE_PULSE,
      p0: 0.69,
      inc: 0.03,
      d: NaN,
      w: 0.3,
    },
    {
      name: 'a Saw reset with no edge of its own',
      kind: SHAPE_SAW,
      p0: 0.4,
      inc: 0.05,
      d: 0.3,
      w: 1,
    },
    {
      name: 'a Square reset from its low half',
      kind: SHAPE_SQUARE,
      p0: 0.7,
      inc: 0.05,
      d: 0.6,
      w: 1,
    },
    {
      name: 'a Square reset from its high half',
      kind: SHAPE_SQUARE,
      p0: 0.2,
      inc: 0.05,
      d: 0.6,
      w: 1,
    },
  ])('sums $name', ({ kind, p0, inc, d, w }) => {
    near(edges(kind, p0, inc, d, w), walked(kind, p0, inc, d, w));
  });

  it('sums a reset through a ratio sweep just below and through a whole number', () => {
    // Synced to a note 128 samples long, at ratio r the reset meets phase
    // frac(r): just under 1 below 2 (a wrap the reset forestalls), then a
    // wrap of its own in the same sample as the reset, then just over 0.
    const d = 0.3;
    for (let r = 1.99; r < 2.01; r += 0.0013) {
      const inc = r / 128;
      const before = r - Math.floor(r);
      const p0 = before - (1 - d) * inc + 1;
      const start = p0 - Math.floor(p0);
      for (const kind of [SHAPE_SAW, SHAPE_SQUARE, SHAPE_PULSE]) {
        near(edges(kind, start, inc, d, 0.3), walked(kind, start, inc, d, 0.3));
      }
    }
  });

  it('sums a wrap in the same sample as a reset, and one exactly at it', () => {
    near(edges(SHAPE_SAW, 0.98, 0.04, 0.25, 1), walked(SHAPE_SAW, 0.98, 0.04, 0.25, 1));
    // The free-running phase reaches 1 at the reset instant: one step, the whole rise.
    const [hold, owe] = edges(SHAPE_SAW, 0.75, 0.5, 0.5, 1);
    expect(hold).toBeCloseTo(G * Math.PI * 0.5 * 0.5 * SYNC_BLEP_GAIN, 12);
    expect(owe).toBeCloseTo(G * Math.PI * 0.5 * 0.5 * SYNC_BLEP_GAIN, 12);
  });

  it('sums a duty edge within a sample of a reset, before it and after it', () => {
    // The Square falls at 0.5 a fifth of a sample before the reset.
    near(edges(SHAPE_SQUARE, 0.485, 0.05, 0.5, 1), walked(SHAPE_SQUARE, 0.485, 0.05, 0.5, 1));
    // A Pulse at width 0.99 falls at 0.01, just after the reset's phase 0.
    near(edges(SHAPE_PULSE, 0.5, 0.05, 0.6, 0.99), walked(SHAPE_PULSE, 0.5, 0.05, 0.6, 0.99));
    // At width 1 a Pulse is silent: nothing to correct.
    expect(edges(SHAPE_PULSE, 0.98, 0.05, 0.6, 1)).toEqual([0, 0]);
  });

  it('reads the next wave at the phase now, a falling Saw positive just after phase 0', () => {
    const sync = new VoiceSync();
    const voice = {
      sync,
      phase: Float64Array.of(0.01, 0, 0, 0),
      phaseInc: Float64Array.of(0.01, 0, 0, 0),
      width: Float32Array.of(1, 1, 1, 1),
    } as unknown as Voice;
    sync.shape.direct = 1;
    sync.shape.gain[0] = G;
    sync.shape.kind[0] = SHAPE_SAW;
    sync.shape.prev[0] = 0;
    syncShapeEdges(voice);
    expect(sync.shape.next[0]).toBeCloseTo(((G * Math.PI) / 2) * 0.98, 12);
    expect(sync.shape.next[0]).toBeGreaterThan(0);
  });
});

describe('beginSyncShapeBlock', () => {
  /** An eligible Saw on operator A, reading `table`, with `fb` and `squeezed` as given. */
  function block(table: Float32Array, fb = 0, squeezed = 0): InstanceType<typeof VoiceSync> {
    const sync = new VoiceSync();
    sync.shape.eligible = 1;
    sync.shape.kind[0] = SHAPE_SAW;
    sync.after[0] = 0.25;
    const voice = {
      sync,
      fbTo: Float32Array.of(fb, 0, 0, 0),
      fbRamp: 0,
      tables: [table, null, null, null],
      phase: Float64Array.of(0.25, 0, 0, 0),
      width: Float32Array.of(1, 1, 1, 1),
    } as unknown as Voice;
    sync.shape.direct = 1;
    beginSyncShapeBlock(voice, squeezed);
    return sync;
  }

  it('reads the level off the table’s fundamental, at every table length', () => {
    const mips = getMips(WAVE.SAW, 48000, 1, null);
    const lengths = new Set(mips.map((t) => t.length - 1));
    expect(lengths.size).toBeGreaterThan(1);
    for (const t of mips) {
      const n = t.length - 1;
      let fundamental = 0;
      for (let k = 0; k < n; k++) fundamental += t[k]! * Math.sin((2 * Math.PI * k) / n);
      fundamental *= 2 / n;
      const sync = block(t);
      expect(sync.shape.gain[0], `table of ${n}`).toBeCloseTo(fundamental, 5);
      expect(sync.shape.next[0]).toBeCloseTo(((fundamental * Math.PI) / 2) * 0.5, 5);
    }
  });

  it('leaves the shape for a feedback or a squeeze, dropping what the next wave owes', () => {
    const t = getMips(WAVE.SAW, 48000, 1, null)[5]!;
    expect([block(t).shape.direct, block(t).after[0]]).toEqual([1, 0.25]);
    for (const sync of [block(t, 0.001), block(t, 0, 1)]) {
      expect([sync.shape.direct, sync.after[0]]).toEqual([0, 0]);
    }
  });
});
