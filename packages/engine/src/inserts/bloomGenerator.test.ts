/**
 * bloom's generator levers, through the shipped bundle: Shape's partial
 * levels and signs at each corner, Bright's tilt in dB per octave, Octave's
 * pitch at every step, Scale's re-pitching (ties down; in-scale notes to the
 * bit), the partial cap under Nyquist, and no click when a control moves.
 * The defaults' neutrality to the bit is `bloomGolden.test.ts`'s.
 *
 * Every render is the generated layer alone (Mix 100 %) of one steady tone.
 * 250 Hz sits off its band's centre (B3, 246.9 Hz), so a ratio that kept the
 * centre rather than the input would show; it also fits 125 whole periods in
 * the half-second window the lines are read over.
 */
// reads-by-path: packages/engine/src/worklet/generated/**, packages/engine/src/__fixtures__/**
import { describe, expect, it } from 'vitest';
import { bloomRig, renderBloom, tone } from '../__fixtures__/bloomHarness';
import { BLOOM_OCTAVES, BLOOM_SCALES } from './bloomConstants';
import type { BloomSpec } from './bloomSpec';

const RATE = 48000;
const HZ = 250;
const FROM = 0.5 * RATE,
  TO = 1.0 * RATE;

interface GeneratorInternals {
  mix: Float64Array;
  bandGain: Float64Array;
  partials: Int32Array;
  pitch: { ratio: Float64Array; mode: Int32Array };
}

/** The complex amplitude of `hz` in `data` over frames [from, to). */
function line(data: Float32Array, hz: number, from = FROM, to = TO): [number, number] {
  let re = 0,
    im = 0;
  for (let i = from; i < to; i++) {
    const phase = (2 * Math.PI * hz * i) / RATE;
    re += data[i]! * Math.cos(phase);
    im -= data[i]! * Math.sin(phase);
  }
  return [(2 * re) / (to - from), (2 * im) / (to - from)];
}

const magnitude = ([re, im]: [number, number]): number => Math.hypot(re, im);
const db = (x: number): number => 20 * Math.log10(x);

function wet(spec: Partial<BloomSpec>, hz = HZ, seconds = 1.1, rate = RATE): Float32Array {
  return renderBloom({ mix: 1, ...spec }, { rate, seconds, source: tone(hz, 0.25, rate) }).left;
}

/**
 * Partial k's signed weight relative to the fundamental's, from the lines'
 * phases: for y = Σ w_k sin(kφ), q_k = i·c_k ∝ w_k e^{ikφ0}, so w_k/w_1 is
 * q_k · conj(q_1)^k / |q_1|^(k+1), real.
 */
function partialWeights(data: Float32Array, f0: number, count: number): number[] {
  const turn = ([re, im]: [number, number]): [number, number] => [-im, re];
  const q1 = turn(line(data, f0));
  const m1 = magnitude(q1);
  const out: number[] = [];
  for (let k = 1; k <= count; k++) {
    const qk = turn(line(data, k * f0));
    const angle = -k * Math.atan2(q1[1], q1[0]);
    const re = qk[0] * Math.cos(angle) - qk[1] * Math.sin(angle);
    out.push(re / m1);
  }
  return out;
}

/** The fundamental's frequency near `hz`, from its phase advance between two windows 0.3 s apart. */
function fundamentalHz(data: Float32Array, hz: number): number {
  const span = 0.2 * RATE,
    gap = 0.3 * RATE,
    from = 0.45 * RATE;
  const a = line(data, hz, from, from + span),
    b = line(data, hz, from + gap, from + gap + span);
  const turn = Math.atan2(b[1] * a[0] - b[0] * a[1], b[0] * a[0] + b[1] * a[1]);
  return hz + turn / (2 * Math.PI * (gap / RATE));
}

const cents = (hz: number, reference: number): number => 1200 * Math.log2(hz / reference);
const NOTE_HZ = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Line k·f0's complex amplitude in `data` over the line at k·f0 in `reference`, k = 1 … count. */
function ratios(
  data: Float32Array,
  reference: Float32Array,
  f0: number,
  count: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 1; k <= count; k++) {
    const [ar, ai] = line(data, k * f0),
      [br, bi] = line(reference, k * f0);
    const d = br * br + bi * bi;
    out.push([(ar * br + ai * bi) / d, (ai * br - ar * bi) / d]);
  }
  return out;
}

/** The saw's partial k: (−1)^(k+1)/k. */
const SAW = (k: number): number => (k % 2 ? 1 : -1) / k;

describe('bloom Shape', () => {
  // Each corner's partials over the saw's, at the same level (so the roll-off and the darkening cancel), re k = 1.
  const width = 0.1;
  const corners: [string, number, (k: number) => [number, number]][] = [
    ['sine', 0, (k) => [k === 1 ? 1 : 0, 0]],
    ['triangle', 1, (k) => [(k % 2 ? (k % 4 === 3 ? -1 : 1) / (k * k) : 0) / SAW(k), 0]],
    ['square', 3, (k) => [(k % 2 ? 1 / k : 0) / SAW(k), 0]],
    // ½·(saw(θ) − saw(θ + w)): partial k is the saw's × (1 − e^{i2πkw})/2.
    [
      'pulse (width 0.1)',
      4,
      (k) => [(1 - Math.cos(2 * Math.PI * k * width)) / 2, -Math.sin(2 * Math.PI * k * width) / 2],
    ],
  ];
  const saw = (): Float32Array => wet({});
  for (const [name, shape, expected] of corners) {
    it(`${name} (${shape}): partial levels and phases over the saw's, from the render`, () => {
      const got = ratios(wet({ shape }), saw(), HZ, 10);
      const [g1r, g1i] = got[0]!,
        [e1r, e1i] = expected(1);
      for (let k = 1; k <= 10; k++) {
        // Both re k = 1, so Shape's level drops out.
        const [gr, gi] = got[k - 1]!,
          [er, ei] = expected(k);
        const gm = Math.hypot(gr, gi) / Math.hypot(g1r, g1i),
          em = Math.hypot(er, ei) / Math.hypot(e1r, e1i);
        if (em < 1e-9) {
          // A null: the pulse's two linear table reads leave it near −50 dB, the others under −60.
          expect(gm, `k=${k}`).toBeLessThan(1e-2);
          continue;
        }
        expect(db(gm) - db(em), `k=${k} dB`).toBeCloseTo(0, 1);
        const turn = Math.atan2(gi, gr) - Math.atan2(g1i, g1r),
          want = Math.atan2(ei, er) - Math.atan2(e1i, e1r);
        const off = Math.atan2(Math.sin(turn - want), Math.cos(turn - want));
        expect(Math.abs(off), `k=${k} phase`).toBeLessThan(0.01);
      }
    });
  }

  it("saw (2): partials at 1/k with the saw's signs, under the roll-off", () => {
    const weights = partialWeights(saw(), HZ, 10);
    for (let k = 1; k <= 10; k++) {
      expect(Math.sign(weights[k - 1]!), `k=${k} sign`).toBe(Math.sign(SAW(k)));
      // The roll-off and the darkening at −12 dBFS take about 0.5 dB by 2.5 kHz.
      const below = db(Math.abs(weights[k - 1]!)) - db(Math.abs(SAW(k)));
      expect(below, `k=${k} dB`).toBeLessThanOrEqual(0.01);
      expect(below, `k=${k} dB`).toBeGreaterThan(-0.7);
    }
  });

  it('keeps the level: every shape has the saw’s power in the render', () => {
    const power = (data: Float32Array): number => {
      let sum = 0;
      for (let i = FROM; i < TO; i++) sum += data[i]! * data[i]!;
      return sum;
    };
    const flat = power(saw());
    for (const shape of [0, 0.5, 1, 1.5, 2.5, 3, 3.5, 4])
      expect(db(power(wet({ shape })) / flat) / 2, `shape ${shape}`).toBeCloseTo(0, 1);
  });

  it('mixes the corners, narrows the pulse from the square, and lands on the saw exactly', () => {
    const rig = bloomRig({ mix: 1 });
    const generator = (rig.processor.dsp as unknown as { generator: GeneratorInternals }).generator;
    // mix: region, t, gain A, gain B, B's offset (turns).
    const at = (shape: number): number[] => {
      rig.params['shape']![0] = shape;
      rig.render(0.5 * RATE, tone(HZ, 0.25, RATE));
      return Array.from(generator.mix.subarray(0, 5));
    };
    expect(at(0.5)).toEqual([0, 0.5, 0.5, 0.5, 0]); // sine ↔ triangle
    expect(at(1.5)).toEqual([1, 0.5, 0.5, 0.5, 0]); // triangle ↔ saw
    expect(at(2.5)).toEqual([2, 0.5, 0.75, -0.25, 0.5]); // the saw's even partials half gone
    expect(at(3)).toEqual([3, 0, 0.5, -0.5, 0.5]); // the square, as the widest pulse
    expect(at(4)[4]).toBeCloseTo(0.1, 12); // the narrowest pulse
    rig.params['shape']![0] = 2;
    rig.render(0.5 * RATE, tone(HZ, 0.25, RATE));
    expect(Array.from(generator.mix.subarray(0, 4))).toEqual([2, 0, 1, -0]);
    expect(Array.from(generator.bandGain).every((g) => g === 1)).toBe(true);
  });
});

describe('bloom Bright', () => {
  for (const bright of [-12, -6, 3, 6]) {
    it(`tilts the saw by ${bright} dB/oct`, () => {
      const got = ratios(wet({ bright }), wet({}), HZ, 8);
      const first = db(Math.hypot(...got[0]!));
      // The tilt is shelves a half octave apart: within 0.25 dB of the power law here (their ripple).
      for (const k of [2, 4, 8]) {
        const off = db(Math.hypot(...got[k - 1]!)) - first - bright * Math.log2(k);
        expect(Math.abs(off), `k=${k}`).toBeLessThan(0.25);
      }
    });
  }

  it('keeps the shape’s power: the tilt is a tone control, not a level', () => {
    const power = (data: Float32Array): number => {
      let sum = 0;
      for (let i = FROM; i < TO; i++) sum += data[i]! * data[i]!;
      return sum;
    };
    const flat = power(wet({}));
    for (const bright of [-12, 6]) expect(db(power(wet({ bright })) / flat) / 2).toBeCloseTo(0, 0);
  });
});

describe('bloom Octave', () => {
  const ratios: Record<number, number> = { [-12]: 0.5, 0: 1, 7: 1.5, 12: 2, 19: 3, 24: 4 };
  for (const octave of BLOOM_OCTAVES) {
    it(`${octave} st generates at ×${ratios[octave]} of the input, within a cent`, () => {
      const want = HZ * ratios[octave]!;
      expect(Math.abs(cents(fundamentalHz(wet({ octave }), want), want))).toBeLessThan(1);
    });
  }

  it('the fractional ratios keep the shape: a −12 saw has its partials at 1/k', () => {
    const weights = partialWeights(wet({ octave: -12 }), HZ / 2, 6);
    for (let k = 1; k <= 6; k++)
      expect(weights[k - 1]! * k, `k=${k}`).toBeCloseTo(k % 2 ? 1 : -1, 1);
  });
});

describe('bloom Key and Scale', () => {
  const cases: [string, string, string, number, number][] = [
    // [key, scale, what, input MIDI note, expected MIDI note]
    ['C', 'major', 'C♯4 → C4 (a tie goes down)', 61, 60],
    ['C', 'major', 'F♯4 → F4 (a tie goes down)', 66, 65],
    ['C', 'minor', 'E4 → E♭4', 64, 63],
    ['D', 'major', 'F4 → E4 (the key moves the scale)', 65, 64],
    ['C', 'pentatonic-major', 'F4 → E4 (nearest, not a tie)', 65, 64],
    ['C', 'pentatonic-major', 'F♯4 → G4 (nearest, up)', 66, 67],
  ];
  for (const [k, scale, what, from, to] of cases) {
    it(`${k} ${scale}: ${what}`, () => {
      const data = wet(
        { key: k as BloomSpec['key'], scale: scale as BloomSpec['scale'] },
        NOTE_HZ(from),
      );
      const want = NOTE_HZ(to);
      expect(Math.abs(cents(fundamentalHz(data, want), want))).toBeLessThan(1);
    });
  }

  it('re-pitches before Octave: C major, +12, C♯4 → C5', () => {
    const data = wet({ scale: 'major', octave: 12 }, NOTE_HZ(61));
    expect(Math.abs(cents(fundamentalHz(data, NOTE_HZ(72)), NOTE_HZ(72)))).toBeLessThan(1);
  });

  it('leaves an in-scale note untouched, to the bit, once the onset has passed', () => {
    // The onset briefly sounds the low bands (they ring longest), which are re-pitched.
    const d4 = NOTE_HZ(62);
    const plain = wet({}, d4);
    for (const spec of [
      { scale: 'major' },
      { scale: 'dorian', key: 'D' },
    ] as Partial<BloomSpec>[]) {
      const scaled = wet(spec, d4);
      let differ = 0;
      for (let i = 0.5 * RATE; i < plain.length; i++) if (scaled[i] !== plain[i]) differ++;
      expect(differ).toBe(0);
    }
  });
});

describe('bloom partials under Nyquist', () => {
  it('caps every band at every Octave, Key and Scale, at every rate, below 0.45 · rate even at its edge', () => {
    for (const rate of [44100, 48000, 96000]) {
      for (const octave of BLOOM_OCTAVES) {
        for (const scale of BLOOM_SCALES) {
          const rig = bloomRig({ octave, scale, key: 'F#' }, rate);
          const dsp = rig.processor.dsp as unknown as {
            generator: GeneratorInternals;
            bands: { centre: Float64Array };
          };
          const { partials, pitch } = dsp.generator;
          for (let b = 0; b < 48; b++) {
            const top = partials[b]! * dsp.bands.centre[b]! * pitch.ratio[b]!;
            expect(top).toBeLessThanOrEqual(0.45 * rate);
            expect(top * 2 ** (1 / 24) * 1.01).toBeLessThan(rate / 2);
          }
        }
      }
    }
  });

  it('E6 at +24, 44.1 kHz: nothing folds back', () => {
    const rate = 44100,
      hz = NOTE_HZ(88);
    const data = renderBloom(
      { mix: 1, octave: 24, bright: 6 },
      { rate, seconds: 1.1, source: tone(hz, 0.25, rate) },
    ).left;
    const at = (f: number): number => {
      let re = 0,
        im = 0;
      for (let i = 0.5 * rate; i < rate; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - 0.5 * rate)) / (0.5 * rate));
        re += w * data[i]! * Math.cos((2 * Math.PI * f * i) / rate);
        im -= w * data[i]! * Math.sin((2 * Math.PI * f * i) / rate);
      }
      return Math.hypot(re, im);
    };
    const fundamental = at(4 * hz);
    expect(fundamental).toBeGreaterThan(0);
    for (let k = 2; k <= 16; k++) {
      const folded = Math.abs(((k * 4 * hz + rate / 2) % rate) - rate / 2);
      if (k * 4 * hz < rate / 2) continue;
      expect(
        db(at(folded) / fundamental),
        `partial ${k} folded to ${folded.toFixed(0)} Hz`,
      ).toBeLessThan(-80);
    }
  });
});

describe('bloom generator controls move without a click', () => {
  /** The largest sample-to-sample step over frames [from, to). */
  const slew = (data: Float32Array, from: number, to: number): number => {
    let most = 0;
    for (let i = from + 1; i < to; i++) most = Math.max(most, Math.abs(data[i]! - data[i - 1]!));
    return most;
  };
  const moves: [string, Partial<BloomSpec>, Partial<BloomSpec>][] = [
    ['Shape saw → sine', {}, { shape: 0 }],
    ['Shape sine → saw', { shape: 0 }, { shape: 2 }],
    ['Shape saw → pulse', {}, { shape: 4 }],
    ['Bright 0 → +6', {}, { bright: 6 }],
    ['Bright 0 → −12', {}, { bright: -12 }],
    ['Octave 0 → +24', {}, { octave: 24 }],
    ['Octave 0 → −12', {}, { octave: -12 }],
    ['Octave +7 → +19', { octave: 7 }, { octave: 19 }],
    ['Scale chromatic → C major (C♯ re-pitched)', {}, { scale: 'major' }],
  ];
  for (const [name, before, after] of moves) {
    it(name, () => {
      const hz = NOTE_HZ(61);
      const rig = bloomRig({ mix: 1, ...before });
      const settled = rig.render(0.5 * RATE, tone(hz, 0.25, RATE));
      const steadyBefore = slew(settled.left, 0.3 * RATE, 0.5 * RATE);
      const moved = rig.render(0.5 * RATE, tone(hz, 0.25, RATE), {
        onBlock: (frame, params) => {
          if (frame === 0)
            for (const [field, value] of Object.entries(after))
              params[field]![0] =
                field === 'scale' ? BLOOM_SCALES.indexOf(value as never) : (value as number);
        },
      });
      const steadyAfter = slew(moved.left, 0.3 * RATE, 0.5 * RATE);
      const during = slew(moved.left, 0, 0.3 * RATE);
      expect(during).toBeLessThanOrEqual(1.05 * Math.max(steadyBefore, steadyAfter));
    });
  }
});
