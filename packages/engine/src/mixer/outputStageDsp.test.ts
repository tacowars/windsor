/**
 * The output stage's DSP (windsor#93), driven directly: unity under the
 * ceiling in every mode, never past it, `off` bit for bit, the latency each
 * mode reports against the delay it has, and the report's numbers.
 */
import { describe, expect, it } from 'vitest';

import {
  OUTPUT_OVERSAMPLE,
  OUTPUT_SOFT_CLIP,
  OUTPUT_STAGE_MODES,
  silentReport,
} from './outputStageConstants';
import type { OutputStageMode, OutputStageReport } from './outputStageConstants';
import { halfBandTaps } from './outputStageClipper';
import { OutputStageDsp, dbToGain, outputStageLatency } from './outputStageDsp';
import { OutputLimiter } from './outputStageLimiter';

const RATE = 48000;
const BLOCK = 128;

interface Run {
  left: Float32Array;
  right: Float32Array;
  report: OutputStageReport;
  latency: number;
}

/** Run a stereo signal through a fresh stage in `mode`, block by block. */
function run(
  mode: OutputStageMode,
  left: Float32Array,
  right: Float32Array,
  options: { ceilingDb?: number; lookahead?: boolean; rate?: number } = {},
): Run {
  const dsp = new OutputStageDsp(options.rate ?? RATE);
  const index = OUTPUT_STAGE_MODES.indexOf(mode);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(left.length);
  for (let at = 0; at < left.length; at += BLOCK) {
    dsp.configure(index, options.ceilingDb ?? -1, options.lookahead ?? false);
    dsp.process(
      left.subarray(at, at + BLOCK),
      right.subarray(at, at + BLOCK),
      outL.subarray(at, at + BLOCK),
      outR.subarray(at, at + BLOCK),
      Math.min(BLOCK, left.length - at),
    );
  }
  const report = silentReport();
  dsp.takeReport(report);
  return { left: outL, right: outR, report, latency: dsp.latency };
}

/** A two-tone stereo signal whose sample peak is `peak`, the right a different mix. */
function tones(peak: number, frames = RATE / 4): [Float32Array, Float32Array] {
  const l = new Float32Array(frames);
  const r = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / RATE;
    l[i] = 0.7 * Math.sin(2 * Math.PI * 220 * t) + 0.3 * Math.sin(2 * Math.PI * 1370 * t);
    r[i] = 0.6 * Math.sin(2 * Math.PI * 330 * t + 1) + 0.4 * Math.sin(2 * Math.PI * 90 * t);
  }
  const scale = peak / Math.max(maxAbs(l), maxAbs(r));
  for (let i = 0; i < frames; i++) {
    l[i] = l[i]! * scale;
    r[i] = r[i]! * scale;
  }
  return [l, r];
}

const maxAbs = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

/** `out` is `input` delayed by `latency` frames, bit for bit, and silent before. */
function expectDelayedCopy(out: Float32Array, input: Float32Array, latency: number): void {
  for (let i = 0; i < latency; i++) expect(out[i]).toBe(0);
  let mismatches = 0;
  for (let i = latency; i < out.length; i++)
    if (!Object.is(out[i], input[i - latency])) mismatches++;
  expect(mismatches).toBe(0);
}

const CASES: { mode: OutputStageMode; lookahead: boolean }[] = [
  { mode: 'limiter', lookahead: false },
  { mode: 'limiter', lookahead: true },
  { mode: 'soft', lookahead: false },
  { mode: 'hard', lookahead: false },
];

describe('under the ceiling', () => {
  it.each(CASES)('$mode (lookahead $lookahead) passes a signal 3 dB under it unchanged', (c) => {
    for (const ceilingDb of [-12, -1, 0]) {
      // The soft clip bends from its knee: 3 dB under that instead.
      const under = c.mode === 'soft' ? ceilingDb - OUTPUT_SOFT_CLIP.kneeDb - 3 : ceilingDb - 3;
      const [l, r] = tones(dbToGain(under));
      const out = run(c.mode, l, r, { ceilingDb, lookahead: c.lookahead });
      expect(out.latency).toBe(outputStageLatency(c, RATE));
      expectDelayedCopy(out.left, l, out.latency);
      expectDelayedCopy(out.right, r, out.latency);
      expect(out.report).toMatchObject({ reductionDb: 0, overDb: 0, active: false });
    }
  });

  it('off passes everything bit for bit, even past full scale, and still reports its peaks', () => {
    const [l, r] = tones(2.5);
    l[100] = -0;
    const out = run('off', l, r, { ceilingDb: -6 });
    expect(out.latency).toBe(0);
    expectDelayedCopy(out.left, l, 0);
    expectDelayedCopy(out.right, r, 0);
    expect(out.report.inputLeft).toBeCloseTo(maxAbs(l), 6);
    expect(out.report.outputRight).toBeCloseTo(maxAbs(r), 6);
    expect(Math.max(out.report.outputLeft, out.report.outputRight)).toBeCloseTo(2.5, 5);
    expect(out.report).toMatchObject({ reductionDb: 0, overDb: 0, active: false });
  });

  it('keeps a negative zero negative (a multiply by exactly 1, never an add)', () => {
    const l = new Float32Array(BLOCK * 4).fill(-0);
    for (const c of CASES) {
      const out = run(c.mode, l, l, { lookahead: c.lookahead });
      expect(Object.is(out.left[out.left.length - 1], -0)).toBe(true);
    }
  });
});

describe('over the ceiling', () => {
  it.each(CASES)('$mode (lookahead $lookahead) never passes it at 12 dB over', (c) => {
    for (const ceilingDb of [-12, -1, 0]) {
      const [l, r] = tones(dbToGain(ceilingDb + 12));
      const out = run(c.mode, l, r, { ceilingDb, lookahead: c.lookahead });
      const ceiling = Math.fround(dbToGain(ceilingDb));
      expect(maxAbs(out.left)).toBeLessThanOrEqual(ceiling);
      expect(maxAbs(out.right)).toBeLessThanOrEqual(ceiling);
      // It is still loud: the stage limits, it does not mute.
      expect(maxAbs(out.left)).toBeGreaterThan(ceiling * dbToGain(-3));
      expect(out.report.active).toBe(true);
    }
  });

  it('reports the limiter as gain reduction and the clippers as the amount over', () => {
    const [l, r] = tones(dbToGain(-1 + 12));
    const limited = run('limiter', l, r, { lookahead: true }).report;
    expect(limited.reductionDb).toBeCloseTo(12, 1);
    expect(limited.overDb).toBe(0);
    for (const mode of ['soft', 'hard'] as const) {
      const clipped = run(mode, l, r).report;
      expect(clipped.overDb).toBeCloseTo(12, 4);
      expect(clipped.reductionDb).toBe(0);
    }
    expect(run('off', l, r).report).toMatchObject({ overDb: 0, reductionDb: 0, active: false });
  });

  it('limits with lookahead before the peak, so the final clip has nothing to catch', () => {
    // A step from quiet to 12 dB over: without lookahead the attack lets the
    // first samples through to the clip, with it the gain is already down.
    const frames = RATE / 10;
    const l = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      l[i] = (i < frames / 2 ? 0.1 : 3.5) * Math.sin((2 * Math.PI * 440 * i) / RATE);
    }
    const overshoot = (lookahead: boolean): number => {
      const limiter = new OutputLimiter(RATE);
      limiter.setCeiling(Math.fround(dbToGain(-1)));
      limiter.setLookahead(lookahead);
      const activity = { minGain: 1, overshoot: 1 };
      const out = new Float32Array(frames);
      limiter.process(l, l, out, new Float32Array(frames), frames, activity);
      expect(maxAbs(out)).toBeLessThanOrEqual(Math.fround(dbToGain(-1)));
      expect(activity.minGain).toBeLessThan(dbToGain(-10));
      return activity.overshoot;
    };
    // With lookahead, at most float rounding reaches the clip.
    expect(overshoot(true)).toBeLessThan(1 + 1e-12);
    expect(overshoot(false)).toBeGreaterThan(dbToGain(1));
  });

  it('recovers to exactly unity after a limited passage, so what follows passes untouched', () => {
    // The release is 80 ms, and the gain snaps to 1 within 1e-6 of it: about
    // a second after 10 dB of reduction.
    const frames = 2 * RATE;
    const l = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const hot = i < RATE / 10;
      l[i] = (hot ? 3 : 0.3) * Math.sin((2 * Math.PI * 300 * i) / RATE);
    }
    for (const lookahead of [false, true]) {
      const out = run('limiter', l, l, { lookahead });
      const tail = out.left.subarray(frames - RATE / 4);
      const input = l.subarray(frames - RATE / 4 - out.latency, frames - out.latency);
      expect(tail.every((v, i) => Object.is(v, input[i]))).toBe(true);
    }
  });
});

describe('the soft clip', () => {
  const ceiling = dbToGain(-1);
  const knee = ceiling * dbToGain(-OUTPUT_SOFT_CLIP.kneeDb);
  const curve = (x: number): number => {
    const u = (x - knee) / (ceiling - knee);
    return x <= knee ? x : knee + ((ceiling - knee) * u) / (1 + u);
  };

  it('holds a steady level on its curve: under the ceiling however far past it', () => {
    for (const level of [knee * 1.1, ceiling, ceiling * 2, ceiling * 100]) {
      const dc = new Float32Array(BLOCK * 8).fill(level);
      const out = run('soft', dc, dc);
      const settled = out.left[out.left.length - 1]!;
      expect(settled).toBeCloseTo(curve(level), 6);
      expect(settled).toBeLessThan(Math.fround(ceiling));
    }
  });

  it('leaves the knee at slope 1 and rises monotonically', () => {
    const eps = 1e-6;
    expect((curve(knee + eps) - curve(knee)) / eps).toBeCloseTo(1, 4);
    let last = 0;
    for (let x = 0; x < 10; x += 0.01) {
      expect(curve(x)).toBeGreaterThanOrEqual(last);
      last = curve(x);
    }
  });
});

describe('latency', () => {
  it('is 0 for off and the plain limiter, the lookahead with it, and the filters for the clippers', () => {
    for (const rate of [44100, 48000, 96000]) {
      expect(outputStageLatency({ mode: 'off', lookahead: true }, rate)).toBe(0);
      expect(outputStageLatency({ mode: 'limiter', lookahead: false }, rate)).toBe(0);
      expect(outputStageLatency({ mode: 'limiter', lookahead: true }, rate)).toBe(
        Math.round(0.0015 * rate),
      );
      for (const mode of ['soft', 'hard'] as const) {
        expect(outputStageLatency({ mode, lookahead: true }, rate)).toBe(
          (OUTPUT_OVERSAMPLE.taps - 1) / 2,
        );
      }
    }
  });

  it('matches the delay an impulse actually takes through each mode', () => {
    for (const c of [...CASES, { mode: 'off' as const, lookahead: false }]) {
      const impulse = new Float32Array(BLOCK * 2);
      impulse[5] = 0.25;
      const out = run(c.mode, impulse, impulse, { lookahead: c.lookahead });
      expect(out.left.indexOf(0.25)).toBe(5 + outputStageLatency(c, RATE));
    }
  });
});

describe('settings on a running stage', () => {
  it('takes a new ceiling on the next block, and a new mode from silence', () => {
    const dsp = new OutputStageDsp(RATE);
    const [l, r] = tones(1.5, BLOCK * 4);
    const outL = new Float32Array(BLOCK);
    const outR = new Float32Array(BLOCK);
    const block = (b: number): void =>
      dsp.process(l.subarray(b * BLOCK), r.subarray(b * BLOCK), outL, outR, BLOCK);
    dsp.configure(OUTPUT_STAGE_MODES.indexOf('hard'), -1, false);
    block(0);
    expect(dsp.latency).toBe(15);
    dsp.configure(OUTPUT_STAGE_MODES.indexOf('hard'), -6, false);
    block(1);
    expect(maxAbs(outL)).toBeLessThanOrEqual(Math.fround(dbToGain(-6)));
    dsp.configure(OUTPUT_STAGE_MODES.indexOf('limiter'), -6, true);
    expect(dsp.latency).toBe(72);
    block(2);
    dsp.configure(OUTPUT_STAGE_MODES.indexOf('limiter'), -6, false);
    expect(dsp.latency).toBe(0);
    block(3);
    expect(maxAbs(outL)).toBeLessThanOrEqual(Math.fround(dbToGain(-6)));
  });
});

describe('the half-band filter', () => {
  it('passes a constant through each phase unchanged, symmetric about its centre', () => {
    const taps = halfBandTaps();
    expect(taps).toHaveLength((OUTPUT_OVERSAMPLE.taps + 1) / 2);
    expect(taps.reduce((s, t) => s + t, 0)).toBeCloseTo(1, 15);
    for (let k = 0; k < taps.length; k++) {
      expect(taps[k]).toBeCloseTo(taps[taps.length - 1 - k]!, 15);
    }
  });
});
