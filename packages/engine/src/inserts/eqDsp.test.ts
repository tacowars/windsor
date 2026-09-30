/**
 * The shipped Parametric EQ processor (windsor#198), run through its bundle:
 * the curve it plays against `eqResponseDb`, bit-for-bit transparency, the
 * silent path, clicks and stability at the corners of every range.
 */
import { describe, expect, it } from 'vitest';
import {
  eqInternals,
  eqParams,
  HOT_FUNCTIONS,
  loadEq,
  QUANTUM,
  runEq,
  setEqParams,
  sine,
} from '../__fixtures__/eqHarness';
import { EQ_BAND_TYPES, EQ_BOUNDS, EQ_DSP, EQ_SLOPES, EQ_TYPE_ID } from './eqConstants';
import { designEqBand, eqResponseDb } from './eqCoefficients';
import { DEFAULT_EQ } from './eqSpec';
import type { EqBand, EqSpec } from './eqSpec';

const RATE = 48000;
const Q = Math.SQRT1_2;
const band = (
  type: EqBand['type'],
  freq: number,
  gain: number,
  q: number,
  { on = true, slope = 12 }: { on?: boolean; slope?: EqBand['slope'] } = {},
): EqBand => ({ type, freq, gain, q, on, slope });

/** The mockup's "Pad clean-up" state. */
const PAD: EqSpec = {
  kind: 'eq',
  enabled: true,
  scale: 1,
  output: 0,
  bands: [
    band('lowcut', 120, 0, 0.9, { slope: 24 }),
    band('lowshelf', 100, 0, Q, { on: false }),
    band('bell', 320, -3.5, 1.4),
    band('notch', 1240, 0, 8),
    band('bell', 3200, 2.5, 0.9),
    band('bell', 6000, 0, Q, { on: false }),
    band('highshelf', 9000, 1.5, Q),
    band('highcut', 16000, 0, Q, { slope: 48 }),
  ],
};

function noise(seconds: number, rate = RATE, seed = 1): [Float32Array, Float32Array] {
  let s = seed;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
  const n = Math.round(seconds * rate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = next();
    right[i] = next();
  }
  return [left, right];
}

/** The amplitude of the `hz` component over [from, to), by least squares on sin and cos. */
function amplitude(x: Float32Array, hz: number, from: number, to: number, rate = RATE): number {
  let ss = 0,
    cc = 0,
    sc = 0,
    xs = 0,
    xc = 0;
  for (let i = from; i < to; i++) {
    const w = (2 * Math.PI * hz * i) / rate;
    const s = Math.sin(w);
    const c = Math.cos(w);
    ss += s * s;
    cc += c * c;
    sc += s * c;
    xs += x[i]! * s;
    xc += x[i]! * c;
  }
  const det = ss * cc - sc * sc;
  const a = (xs * cc - xc * sc) / det;
  const b = (xc * ss - xs * sc) / det;
  return Math.hypot(a, b);
}

/**
 * The click detector: an eighth-order highpass at 4 kHz, and the peak of what
 * passes it. A test's sine sits at 150 Hz, more than four octaves below, where
 * the highpass takes it down by over 190 dB; the filter's own changes move the
 * sine's level and phase at most a few hundred times a second, which puts
 * their sidebands within a few hundred Hz of it, just as far out of reach. A
 * click is a step or a corner in the waveform, and its energy spreads to the
 * top of the spectrum, so what reaches the detector's output is the click.
 */
const DETECT = { hz: 4000, skip: 0.02 };
function clickPeak(x: Float32Array, rate = RATE): number {
  const c = new Float64Array(20);
  const count = designEqBand(
    { type: EQ_TYPE_ID.lowcut, slope: 48, freq: DETECT.hz, gain: 0, q: Q },
    rate,
    c,
  );
  const y = Float64Array.from(x);
  for (let k = 0; k < count; k++) {
    const [b0, b1, b2, a1, a2] = c.subarray(k * 5, k * 5 + 5) as unknown as number[];
    let z1 = 0,
      z2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = y[i]!;
      const out = b0! * v + z1;
      z1 = b1! * v - a1! * out + z2;
      z2 = b2! * v - a2! * out;
      y[i] = out;
    }
  }
  let peak = 0;
  for (let i = Math.round(DETECT.skip * rate); i < y.length; i++)
    peak = Math.max(peak, Math.abs(y[i]!));
  return peak;
}
/** −80 dBFS: a click this quiet under a −6 dBFS sine is inaudible, and the calibration below reads a −60 dB step far above it. */
const CLICK_LIMIT = 1e-4;

describe('the curve it plays', () => {
  it('matches eqResponseDb within 0.05 dB at 20 frequencies for the pad clean-up', () => {
    const freqs = Array.from({ length: 20 }, (_, i) => 20 * Math.pow(1000, i / 19));
    const expected = eqResponseDb(PAD, freqs, RATE, new Float64Array(20));
    freqs.forEach((hz, i) => {
      const x = sine(hz, 1.5, RATE);
      const [left, right] = runEq(loadEq(RATE), eqParams(PAD), [x, x]);
      for (const out of [left, right]) {
        const db =
          20 *
          Math.log10(
            amplitude(out, hz, RATE / 2, (3 * RATE) / 2) /
              amplitude(x, hz, RATE / 2, (3 * RATE) / 2),
          );
        expect(Math.abs(db - expected[i]!), `${hz.toFixed(0)} Hz`).toBeLessThan(0.05);
      }
    });
  });
});

describe('transparency', () => {
  it('passes a new EQ bit for bit, stereo and mono', () => {
    const input = noise(0.5);
    const [left, right] = runEq(loadEq(), eqParams(DEFAULT_EQ), input);
    expect(left).toEqual(input[0]);
    expect(right).toEqual(input[1]);
    const mono = loadEq();
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    const block = input[0].subarray(0, QUANTUM);
    mono.process([[block]], [out], eqParams(DEFAULT_EQ));
    expect(out).toEqual([block, block]);
  });

  it('passes the input bit for bit once a disabled EQ has faded, and fades back in', () => {
    const input = noise(0.6);
    const params = eqParams(PAD);
    const processor = loadEq();
    const off = Math.round((0.2 * RATE) / QUANTUM);
    const back = Math.round((0.4 * RATE) / QUANTUM);
    const [left, right] = runEq(processor, params, input, (q) => {
      if (q === off) setEqParams(params, { ...PAD, enabled: false });
      if (q === back) setEqParams(params, PAD);
    });
    const faded = off * QUANTUM + Math.ceil(EQ_DSP.enableFadeSeconds * RATE) + QUANTUM;
    expect(left.subarray(faded, back * QUANTUM)).toEqual(input[0].subarray(faded, back * QUANTUM));
    expect(right.subarray(faded, back * QUANTUM)).toEqual(input[1].subarray(faded, back * QUANTUM));
    // Back on: the tail matches a fresh EQ once the fade and the filters have settled.
    const fresh = runEq(loadEq(), eqParams(PAD), input);
    const tail = Math.round(RATE * 0.55);
    for (let i = tail; i < input[0].length; i++)
      expect(Math.abs(left[i]! - fresh[0][i]!)).toBeLessThan(1e-6);
  });

  it('is transparent again once a boosted band glides back to 0 dB', () => {
    const input = noise(1.2);
    const params = eqParams(DEFAULT_EQ);
    const boosted = {
      ...DEFAULT_EQ,
      bands: DEFAULT_EQ.bands.map((b, i) => (i === 3 ? { ...b, gain: 9 } : b)),
    };
    const [left] = runEq(loadEq(), params, input, (q) => {
      if (q === 10) setEqParams(params, boosted);
      if (q === 150) setEqParams(params, DEFAULT_EQ);
    });
    const settled = RATE;
    expect(left.subarray(settled)).toEqual(input[0].subarray(settled));
  });
});

describe('silence', () => {
  it('writes exact zeros after the state has decayed, and filters the first sound after it normally', () => {
    const rate = RATE;
    const sound = noise(0.3, rate, 7);
    const quiet = 1.5;
    const input: [Float32Array, Float32Array] = [
      new Float32Array(Math.round((0.3 + quiet + 0.1) * rate)),
      new Float32Array(Math.round((0.3 + quiet + 0.1) * rate)),
    ];
    input[0].set(sound[0]);
    input[1].set(sound[1]);
    const resume = Math.round(((0.3 + quiet) * rate) / QUANTUM) * QUANTUM;
    const again = noise(0.1, rate, 9);
    input[0].set(again[0].subarray(0, input[0].length - resume), resume);
    input[1].set(again[1].subarray(0, input[1].length - resume), resume);
    const [left, right] = runEq(loadEq(rate), eqParams(PAD), input);
    const zeros = left.subarray(resume - QUANTUM * 20, resume);
    expect(zeros.every((v) => v === 0)).toBe(true);
    expect(right.subarray(resume - QUANTUM * 20, resume).every((v) => v === 0)).toBe(true);
    // From zero state with every value settled, the resumed sound is what a fresh EQ makes of it.
    const fresh = runEq(loadEq(rate), eqParams(PAD), [
      input[0].subarray(resume),
      input[1].subarray(resume),
    ]);
    expect(left.subarray(resume)).toEqual(fresh[0]);
    expect(right.subarray(resume)).toEqual(fresh[1]);
  });
});

describe('clicks', () => {
  const x = sine(150, 1.2, RATE);
  const run = (first: EqSpec, change: (q: number) => EqSpec | null) => {
    const params = eqParams(first);
    const [left] = runEq(loadEq(), params, [x, x], (q) => {
      const next = change(q);
      if (next) setEqParams(params, next);
    });
    return clickPeak(left);
  };
  const only = (b: EqBand): EqSpec => ({
    ...DEFAULT_EQ,
    bands: DEFAULT_EQ.bands.map((d, i) => (i === 2 ? b : { ...d, on: false })),
  });

  it('reads a −60 dB step far above the limit, and a steady sine far below it', () => {
    const step = Float32Array.from(x, (v, i) => v + (i >= RATE / 2 ? 1e-3 : 0));
    expect(clickPeak(step)).toBeGreaterThan(4 * CLICK_LIMIT);
    expect(run(PAD, () => null)).toBeLessThan(CLICK_LIMIT / 10);
  });

  it('sweeps a +12 dB Q 4 bell from 20 Hz to 20 kHz in a second without a click', () => {
    const quanta = RATE / QUANTUM;
    const peak = run(only(band('bell', 20, 12, 4)), (q) =>
      q <= quanta ? only(band('bell', 20 * Math.pow(1000, q / quanta), 12, 4)) : null,
    );
    expect(peak).toBeLessThan(CLICK_LIMIT);
  });

  it('changes type, slope and on mid-signal without a click', () => {
    const steps: EqBand[] = [
      band('bell', 300, 9, 2),
      ...EQ_BAND_TYPES.map((type) => band(type, 300, 9, 2, { slope: 24 })),
      ...EQ_SLOPES.map((slope) => band('lowcut', 200, 0, 2, { slope })),
      ...EQ_SLOPES.map((slope) => band('highcut', 200, 0, 2, { slope })),
      band('highcut', 200, 0, 2, { on: false, slope: 48 }),
      band('bell', 150, -18, 1, { on: false }),
      band('bell', 150, -18, 1),
      band('notch', 150, 0, 18),
      band('notch', 150, 0, 18, { on: false }),
    ];
    const every = Math.floor(RATE / QUANTUM / 24);
    const peak = run(only(steps[0]!), (q) =>
      q % every === 0 && q / every < steps.length ? only(steps[q / every]!) : null,
    );
    expect(peak).toBeLessThan(CLICK_LIMIT);
  });
});

describe('stability', () => {
  it('stays finite through ten seconds of full-scale noise at the corners of every range', () => {
    for (const rate of [44100, 48000, 96000]) {
      const corners: EqSpec[] = [];
      for (const freq of EQ_BOUNDS.freq)
        for (const q of EQ_BOUNDS.q)
          for (const gain of EQ_BOUNDS.gain)
            corners.push({
              kind: 'eq',
              enabled: true,
              scale: 2,
              output: EQ_BOUNDS.output[1],
              bands: EQ_BAND_TYPES.map((type, i) =>
                band(type, freq, gain, q, { slope: EQ_SLOPES[i % 4]! }),
              ).concat([
                band('lowcut', freq, gain, q, { slope: 48 }),
                band('highcut', freq, gain, q, { slope: 6 }),
              ]),
            });
      const input = noise(10, rate, rate);
      const params = eqParams(corners[0]);
      const every = Math.ceil(input[0].length / QUANTUM / corners.length);
      const [left, right] = runEq(loadEq(rate), params, input, (q) => {
        if (q % every === 0) setEqParams(params, corners[q / every]!);
      });
      expect(left.every(Number.isFinite) && right.every(Number.isFinite), `${rate}`).toBe(true);
    }
  });
});

describe('the audio thread', () => {
  /**
   * Rule 2 read off the shipped bundle: every function `process` reaches, and
   * nothing it calls, builds an array, object, closure, string or spread, or
   * calls a method that returns a new one. (The constructors, the parameter
   * table and the curve for the console are outside the audio thread's
   * per-quantum path.)
   */
  it('allocates nothing in anything process() runs (worklet rule 2)', () => {
    const internals = eqInternals();
    const methods = (proto: object): Array<[string, string]> =>
      Object.getOwnPropertyNames(proto)
        .filter((name) => name !== 'constructor')
        .map((name) => [name, String((proto as Record<string, unknown>)[name])]);
    const hot: Array<[string, string]> = [
      ...methods(internals.EqProcessor.prototype),
      ...methods(internals.EqDsp.prototype),
      ...methods(internals.EqBand.prototype),
      ...HOT_FUNCTIONS.map((name): [string, string] => [name, String(internals[name])]),
    ];
    expect(hot.length).toBeGreaterThan(40);
    const allocations = [
      /\bnew\s/,
      /=>/,
      /`/,
      /\.\.\./,
      /(^|[=(,:?]|\breturn)\s*\[/m,
      /(^|[=(,:?]|\breturn)\s*\{/m,
      /\.(map|filter|slice|subarray|concat|push|splice|bind|join|split|from|of)\(/,
      /\b(Array|Object|JSON|String)\b/,
    ];
    for (const [name, source] of hot) {
      const body = source
        .slice(source.indexOf('{') + 1)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const pattern of allocations) expect(body, `${name}: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('declares its class fields and initialises none (worklet rule 7)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../worklet/generated/eq-processor.js', import.meta.url),
      'utf8',
    );
    for (const name of ['EqBand', 'EqDsp', 'EqProcessor']) {
      const body = source.slice(source.indexOf(`class ${name} `));
      const head = body.slice(body.indexOf('{') + 1, body.indexOf('constructor('));
      expect(head.replace(/static get parameterDescriptors\(\) \{[^}]*\}/, '').trim(), name).toBe(
        '',
      );
    }
  });
});
