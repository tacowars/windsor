/**
 * The Transient insert's signal path (record `2026-10-18-transient-insert`),
 * on the shipped bundle through `__fixtures__/transientHarness.ts`:
 *
 * - **Neutral is the input** (decision 7): at Attack 0, Sustain 0, Output
 *   0 dB and Mix 1, once the smoothers have settled, sample for sample; and
 *   fully off is the input to the bit.
 * - **The shapes** (the acceptance's numbers, on the shipped row): a hit
 *   (instant rise, τ = 80 ms) at Attack +15 peaks within 0.5 dB of +15 dB at
 *   its onset, and at Sustain −24 its tail 200 ms in is cut by at least 18 dB;
 *   a held tone takes no gain at any bound.
 * - **Level independence:** the same hit at 0, −20 and −40 dBFS takes gain
 *   curves within 0.05 dB of each other.
 * - **Low notes:** a steady sine at or above `1/(2·hold)` ripples the gain
 *   by under 0.05 dB under every timing row, at Attack +15 and Sustain +24.
 * - **Rates:** the onset's and the decay's gains at 44.1, 48 and 96 kHz
 *   within 0.1 dB of each other.
 * - **Stereo-linked:** both channels take one gain, the louder one's.
 * - **The meter:** with it on, a window's largest boost and cut are posted.
 */
import { describe, expect, it } from 'vitest';
import {
  hit,
  loadTransient,
  runTransient,
  sine,
  transientParams,
  transientSignal,
} from '../__fixtures__/transientHarness';
import { TRANSIENT_DSP } from './transientConstants';
import type { TransientSpec } from './transientSpec';
import { TRANSIENT_TIMINGS } from './transientTables';
import type { TransientTiming } from './transientTables';

const RATE = 48000;
const ONSET = 480;
const TAU = 0.08;

/** The hit's gain, in dB, at `seconds` after its onset (a crest of its 220 Hz carrier). */
function hitGain(spec: Partial<TransientSpec>, { rate = RATE, peak = 0.5 } = {}) {
  const onset = Math.round(0.01 * rate);
  const program = hit(rate, rate, { onset, peak, tauS: TAU });
  const params = transientParams(spec);
  const run = runTransient(loadTransient(rate, params), program, params);
  return (seconds: number): number => run.gainDb[onset + Math.round(seconds * rate)]!;
}

/** The gain's swing, max less min, in dB, over the last second of three of a held sine. */
function ripple(hz: number, spec: Partial<TransientSpec>, timing: TransientTiming): number {
  const program = sine(3 * RATE, RATE, hz);
  const params = transientParams(spec);
  const run = runTransient(loadTransient(RATE, params, { timing }), program, params);
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 2 * RATE; i < 3 * RATE; i++) {
    if (Math.abs(program[0]![i]!) < 0.05) continue;
    lo = Math.min(lo, run.gainDb[i]!);
    hi = Math.max(hi, run.gainDb[i]!);
  }
  return hi - lo;
}

describe('the Transient at neutral and off', () => {
  it('plays the input sample for sample at the defaults', () => {
    const program = hit(RATE, RATE, { onset: ONSET });
    const params = transientParams();
    const run = runTransient(loadTransient(RATE, params), program, params);
    expect(run.left).toEqual(program[0]);
    expect(run.right).toEqual(program[1]);
  });

  it('plays the input again once every control has glided back to neutral', () => {
    const program = transientSignal(2 * RATE, (i) => 0.5 * Math.sin(i / 7) * Math.cos(i / 1300));
    const params = transientParams({ attack: 12, sustain: -20, output: -9, mix: 0.4 });
    const processor = loadTransient(RATE, params);
    const back = Math.round(RATE / 2 / 128);
    const run = runTransient(processor, program, params, (q) => {
      if (q !== back) return;
      params.attack![0] = params.sustain![0] = params.output![0] = 0;
      params.mix![0] = 1;
    });
    // A second after the move: every glide has landed on its target, 30 time constants in.
    const settled = Math.round(1.5 * RATE);
    expect(run.left.subarray(settled)).toEqual(program[0]!.subarray(settled));
    expect(run.right.subarray(settled)).toEqual(program[1]!.subarray(settled));
  });

  it('copies its input to the bit when fully off', () => {
    const program = hit(RATE, RATE / 2, { onset: ONSET });
    const params = transientParams({
      attack: 15,
      sustain: 24,
      output: 6,
      mix: 0.7,
      enabled: false,
    });
    const processor = loadTransient(RATE, params);
    const run = runTransient(processor, program, params);
    expect(processor.dsp.bypassed).toBe(true);
    expect(run.left).toEqual(program[0]);
  });
});

describe('the Transient on a hit', () => {
  it('lifts the onset within 0.5 dB of +15 dB at Attack +15', () => {
    expect(hitGain({ attack: 15 })(0)).toBeGreaterThan(14.5);
    expect(hitGain({ attack: 15 })(0)).toBeLessThanOrEqual(15);
  });

  it('cuts the tail 200 ms in by at least 18 dB at Sustain −24', () => {
    expect(hitGain({ sustain: -24 })(0.2)).toBeLessThan(-18);
  });

  it('gives a held tone no gain at any bound', () => {
    for (const attack of [-15, 15])
      for (const sustain of [-24, 24]) {
        const program = sine(2 * RATE, RATE, 220);
        const params = transientParams({ attack, sustain });
        const run = runTransient(loadTransient(RATE, params), program, params);
        let crest = 2 * RATE - 1;
        while (Math.abs(program[0]![crest]!) < 0.499) crest--;
        expect(Math.abs(run.gainDb[crest]!)).toBeLessThan(1e-4);
      }
  });

  it.each([{ attack: 15 }, { sustain: -24 }, { sustain: 24 }, { attack: 10, sustain: -12 }])(
    'shapes a hit at 0, −20 and −40 dBFS alike: %o',
    (spec) => {
      const curves = [1, 0.1, 0.01].map((peak) => {
        const program = hit(RATE, RATE, { onset: ONSET, peak });
        const params = transientParams(spec);
        return { run: runTransient(loadTransient(RATE, params), program, params), program, peak };
      });
      let worst = 0;
      for (let i = ONSET; i < RATE; i++) {
        const g = curves.map(({ run, program, peak }) =>
          Math.abs(program[0]![i]!) > 1e-6 * peak ? run.gainDb[i]! : NaN,
        );
        if (g.some(Number.isNaN)) continue;
        worst = Math.max(worst, Math.abs(g[0]! - g[1]!), Math.abs(g[0]! - g[2]!));
      }
      expect(worst).toBeLessThan(0.05);
    },
  );

  it.each(Object.entries(TRANSIENT_TIMINGS))(
    'rides a low note at or above 1/(2·hold) without ripple: %s',
    (_name, timing) => {
      const edge = 1000 / (2 * timing.holdMs);
      for (const hz of [30, 42, 55, 110].filter((f) => f >= edge)) {
        expect(ripple(hz, { attack: 15 }, timing), `${hz} Hz`).toBeLessThan(0.05);
        expect(ripple(hz, { sustain: 24 }, timing), `${hz} Hz`).toBeLessThan(0.05);
      }
    },
    20_000,
  );

  it.each([{ attack: 15 }, { attack: -15 }, { sustain: -24 }, { sustain: 24 }])(
    'shapes the onset and the decay alike at 44.1, 48 and 96 kHz: %o',
    (spec) => {
      const gains = [44100, 48000, 96000].map((rate) => hitGain(spec, { rate }));
      for (const seconds of [0, 0.05, 0.2]) {
        const at = gains.map((g) => g(seconds));
        expect(Math.max(...at) - Math.min(...at), `${seconds} s`).toBeLessThan(0.1);
      }
    },
  );

  it('gives both channels one gain, the louder one’s', () => {
    const [left] = hit(RATE, RATE / 2, { onset: ONSET });
    const right = left!.map((v) => -0.25 * v);
    const params = transientParams({ attack: 15, sustain: -24 });
    const run = runTransient(loadTransient(RATE, params), [left!, right], params);
    for (let i = ONSET; i < RATE / 2; i += 97) {
      if (Math.abs(left![i]!) < 1e-3) continue;
      expect(run.right[i]! / right[i]!).toBeCloseTo(run.left[i]! / left![i]!, 5);
    }
  });
});

describe('the Transient meter', () => {
  it('posts each window’s largest boost and cut while it is on', () => {
    const params = transientParams({ attack: 15, sustain: -24 });
    const processor = loadTransient(RATE, params);
    processor.port.onmessage({ data: { type: 'meter', enabled: true } });
    runTransient(processor, hit(RATE, RATE / 2, { onset: ONSET }), params);
    const posts = processor.port.posted.filter(
      (m) => (m as { type: string }).type === 'shaping',
    ) as { boost: number; cut: number }[];
    expect(posts.length).toBeGreaterThanOrEqual(Math.floor(TRANSIENT_DSP.meterHz / 2) - 1);
    expect(Math.max(...posts.map((p) => p.boost))).toBeGreaterThan(14.5);
    expect(Math.min(...posts.map((p) => p.cut))).toBeLessThan(-18);
  });

  it('posts nothing while it is off', () => {
    const params = transientParams({ attack: 15 });
    const processor = loadTransient(RATE, params);
    runTransient(processor, hit(RATE, RATE / 4, { onset: ONSET }), params);
    expect(processor.port.posted.some((m) => (m as { type: string }).type === 'shaping')).toBe(
      false,
    );
  });
});
