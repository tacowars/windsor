/**
 * Listen on drag (windsor#200, record `2026-09-30-parametric-eq-insert`
 * decision 9), run through the shipped bundle: while a band is listened to
 * the EQ plays only a band-pass at that band's frequency and Q, every change
 * crossfades without a click, and once it ends the output is the full EQ's to
 * the bit. With Listen never used the render is the one windsor#198 shipped,
 * pinned by a hash taken from that bundle before this ticket changed it, and
 * refreshed once since, by windsor#630's switch fade.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eqParams, loadEq, QUANTUM, runEq, setEqParams, sine } from '../__fixtures__/eqHarness';
import type { EqProcessorLike } from '../__fixtures__/eqHarness';
import { designEqBand } from './eqCoefficients';
import { EQ_LISTEN, EQ_TYPE_ID } from './eqConstants';
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

function noise(seconds: number, seed = 1): [Float32Array, Float32Array] {
  let s = seed;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
  const n = Math.round(seconds * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = next();
    right[i] = next();
  }
  return [left, right];
}

const listen = (processor: EqProcessorLike, index: number): void =>
  processor.port.onmessage({ data: { type: 'listen', band: index } });

const withBand = (spec: EqSpec, index: number, patch: Partial<EqBand>): EqSpec => ({
  ...spec,
  bands: spec.bands.map((b, i) => (i === index ? { ...b, ...patch } : b)),
});

function hash(out: readonly [Float32Array, Float32Array]): string {
  const h = createHash('sha256');
  for (const channel of out) h.update(new Uint8Array(channel.buffer));
  return h.digest('hex');
}

/**
 * Every route the render has: glides, a type change, the enable fading out
 * and back, the output gain, a silent stretch, and a mono quantum's worth of
 * the pad. `extra` runs before each quantum after the scenario's own change.
 */
function scenario(extra?: (q: number, p: EqProcessorLike) => void): [Float32Array, Float32Array] {
  const processor = loadEq(RATE);
  const params = eqParams(PAD);
  const input = noise(2);
  input[0].fill(0, RATE, RATE + RATE / 4);
  input[1].fill(0, RATE, RATE + RATE / 4);
  const changes: Record<number, EqSpec> = {
    60: withBand(PAD, 2, { freq: 900, gain: 6, q: 3 }),
    120: withBand(PAD, 3, { type: 'bell', gain: -9 }),
    180: { ...PAD, enabled: false },
    260: { ...PAD, output: 4.5 },
    500: { ...PAD, scale: 0.5 },
    620: withBand(PAD, 7, { on: false }),
  };
  return runEq(processor, params, input, (q) => {
    if (changes[q]) setEqParams(params, changes[q]);
    extra?.(q, processor);
  });
}

/**
 * The hash of `scenario()` through the windsor#198 bundle, before Listen
 * existed (read with the generated file at the commit this ticket branched
 * from). Listen off must leave every sample where it was. Refreshed by
 * windsor#630, whose linear 5 ms switch fade replaced the 10 ms smoothstep:
 * against the previous bundle, only the samples of the two enable fades
 * (from quanta 180 and 260) moved.
 */
const BEFORE_LISTEN = 'f96a9cef1c302d386659af513a7da205330d8a27c6bd57acaa3b1f4391051b13';

describe('with Listen never used', () => {
  it('renders bit for bit what the EQ rendered before Listen existed', () => {
    expect(hash(scenario())).toBe(BEFORE_LISTEN);
  });
});

/** The amplitude of the `hz` component over [from, to), by least squares on sin and cos. */
function amplitude(x: Float32Array, hz: number, from: number, to: number): number {
  let ss = 0,
    cc = 0,
    sc = 0,
    xs = 0,
    xc = 0;
  for (let i = from; i < to; i++) {
    const w = (2 * Math.PI * hz * i) / RATE;
    const s = Math.sin(w);
    const c = Math.cos(w);
    ss += s * s;
    cc += c * c;
    sc += s * c;
    xs += x[i]! * s;
    xc += x[i]! * c;
  }
  const det = ss * cc - sc * sc;
  return Math.hypot((xs * cc - xc * sc) / det, (xc * ss - xs * sc) / det);
}

const db = (ratio: number): number => 20 * Math.log10(ratio);

/** Half a second into `listen(index)`: the level of an `hz` sine through `spec`, in dB re its input. */
function heard(spec: EqSpec, index: number, hz: number, level = 0.5): number {
  const processor = loadEq(RATE);
  const x = sine(hz, 1, RATE, level);
  listen(processor, index);
  const [left] = runEq(processor, eqParams(spec), [x, x]);
  return db(amplitude(left, hz, RATE / 2, RATE) / level);
}

describe('while a band is listened to', () => {
  it('plays a band-pass of the input at the band: its centre whole, two octaves off far down', () => {
    // The notch at 1240 Hz: the EQ takes 1240 out, and Listen plays what is there to take.
    expect(Math.abs(heard(PAD, 3, 1240))).toBeLessThan(0.05);
    expect(heard(PAD, 3, 310)).toBeLessThan(-25);
    expect(heard(PAD, 3, 4960)).toBeLessThan(-25);
  });

  it('holds the band-pass Q at 0.5 or above', () => {
    const wide = withBand(PAD, 2, { q: 0.1 });
    // A Q of 0.5 two octaves out: 1 / √(1 + 0.25 × 3.75²), −6.5 dB; a Q of 0.1 would be −0.6.
    expect(heard(wide, 2, 320 * 4)).toBeCloseTo(-6.53, 1);
  });

  it('follows the band as it moves', () => {
    const processor = loadEq(RATE);
    const x = sine(2000, 1, RATE);
    const params = eqParams(PAD);
    listen(processor, 2);
    const [left] = runEq(processor, params, [x, x], (q) => {
      if (q === 100) setEqParams(params, withBand(PAD, 2, { freq: 2000 }));
    });
    expect(db(amplitude(left, 2000, 30 * QUANTUM, 90 * QUANTUM) / 0.5)).toBeLessThan(-10);
    expect(Math.abs(db(amplitude(left, 2000, RATE / 2, RATE) / 0.5))).toBeLessThan(0.05);
  });

  it('takes no band it does not have', () => {
    const input = noise(0.2);
    const [plain] = runEq(loadEq(RATE), eqParams(PAD), input);
    for (const band of [8, 1.5, -2, '3', null]) {
      const processor = loadEq(RATE);
      processor.port.onmessage({ data: { type: 'listen', band } });
      const [left] = runEq(processor, eqParams(PAD), input);
      expect(left, String(band)).toEqual(plain);
    }
  });
});

describe('when Listen ends', () => {
  const FADE_QUANTA = Math.ceil((EQ_LISTEN.fadeSeconds * RATE) / QUANTUM) + 1;
  const reference = scenario();

  /** `scenario()` with `listen` messages at the quanta named: different, then equal from `after` on. */
  function restores(messages: Record<number, number>, after: number): void {
    const out = scenario((q, p) => {
      if (messages[q] !== undefined) listen(p, messages[q]);
    });
    const first = Math.min(...Object.keys(messages).map(Number)) * QUANTUM;
    const from = after * QUANTUM;
    expect(out[0].subarray(first, from)).not.toEqual(reference[0].subarray(first, from));
    expect(out[0].subarray(from)).toEqual(reference[0].subarray(from));
    expect(out[1].subarray(from)).toEqual(reference[1].subarray(from));
  }

  it('is the full EQ again to the bit once the fade has run', () => {
    restores({ 40: 3, 90: EQ_LISTEN.off }, 90 + FADE_QUANTA);
  });

  it('comes back from a switch between bands, and from a release mid-fade', () => {
    restores({ 40: 2, 70: 5, 100: EQ_LISTEN.off }, 100 + FADE_QUANTA);
    restores({ 40: 6, 41: EQ_LISTEN.off }, 41 + FADE_QUANTA);
  });

  it('comes back through the enable fade, silence and a type change', () => {
    restores({ 150: 4, 330: EQ_LISTEN.off }, 330 + FADE_QUANTA);
    restores({ 110: 3, 125: EQ_LISTEN.off }, 125 + FADE_QUANTA);
    restores({ 360: 1, 420: EQ_LISTEN.off }, 420 + FADE_QUANTA);
  });
});

/**
 * The click detector of `eqDsp.test.ts`: an eighth-order highpass at 4 kHz and
 * the peak of what passes it, under a 150 Hz sine more than four octaves
 * below. A crossfade between two filterings of that sine moves only its level
 * and phase, so what reaches the detector is a click.
 */
function clickPeak(x: Float32Array): number {
  const c = new Float64Array(20);
  const count = designEqBand(
    { type: EQ_TYPE_ID.lowcut, slope: 48, freq: 4000, gain: 0, q: Q },
    RATE,
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
  for (let i = Math.round(0.02 * RATE); i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]!));
  return peak;
}
/** −80 dBFS, as `eqDsp.test.ts` holds its own changes to. */
const CLICK_LIMIT = 1e-4;

describe('clicks', () => {
  it('starts, switches, follows a drag and ends without a click', () => {
    const x = sine(150, 1.2, RATE);
    const params = eqParams(PAD);
    const processor = loadEq(RATE);
    const [left] = runEq(processor, params, [x, x], (q) => {
      if (q === 20) listen(processor, 2);
      if (q >= 60 && q < 160) setEqParams(params, withBand(PAD, 2, { freq: 320 - q }));
      if (q === 200) listen(processor, 0);
      if (q === 260) listen(processor, 6);
      if (q === 262) listen(processor, 6);
      if (q === 300) listen(processor, EQ_LISTEN.off);
      if (q === 302) listen(processor, 4);
      if (q === 360) listen(processor, EQ_LISTEN.off);
    });
    expect(clickPeak(left)).toBeLessThan(CLICK_LIMIT);
  });
});
