import { expect, it } from 'vitest';
import { loadAdvancedDrive, advancedDriveParams } from '../__fixtures__/advancedDriveHarness';
import { DEFAULT_DRIVE_STAGE } from './advancedDriveSpec';
import type { AdvancedDriveSpec, DriveStageSpec } from './advancedDriveSpec';
import { DRIVE_ROUTES, DRIVE_SHAPERS, DRIVE_DSP } from './advancedDriveConstants';
import { driveShape } from './advancedDriveCurves';
const stage = (s: Partial<DriveStageSpec> = {}): DriveStageSpec => ({
  ...DEFAULT_DRIVE_STAGE,
  shaping: false,
  ...s,
});
const clean = [stage(), stage(), stage()];
function render(
  spec: Partial<AdvancedDriveSpec>,
  options: {
    hz?: number;
    rate?: number;
    amplitude?: number;
    right?: number;
    seconds?: number;
  } = {},
) {
  const { hz = 440, rate = 48000, amplitude = 0.1, right = 1, seconds = 0.25 } = options;
  const params = advancedDriveParams({ stages: clean, ...spec });
  const dsp = loadAdvancedDrive(rate, params),
    input = [new Float32Array(128), new Float32Array(128)];
  const output = [[new Float32Array(128), new Float32Array(128)]];
  const l: number[] = [],
    r: number[] = [];
  for (let block = 0; block < Math.ceil((rate * seconds) / 128); block++) {
    for (let i = 0; i < 128; i++) {
      input[0]![i] = amplitude * Math.sin((2 * Math.PI * hz * (block * 128 + i)) / rate);
      input[1]![i] = input[0]![i]! * right;
    }
    dsp.process([input], output, params);
    l.push(...output[0]![0]!);
    r.push(...output[0]![1]!);
  }
  return { l, r };
}
const rms = (x: number[]): number => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const late = (x: number[]): number[] => x.slice(Math.floor(x.length / 2));
const difference = (a: number[], b: number[]): number => rms(a.map((x, i) => x - b[i]!));
const harmonic = (x: number[], hz: number, rate = 48000): number => {
  let real = 0,
    imaginary = 0;
  x.forEach((v, i) => {
    real += v * Math.cos((2 * Math.PI * hz * i) / rate);
    imaginary += v * Math.sin((2 * Math.PI * hz * i) / rate);
  });
  return (2 * Math.hypot(real, imaginary)) / x.length;
};
it.each([44100, 48000, 96000])(
  'reconstructs three flat bands and phase-matches every dry/wet mix at %i Hz',
  (rate) => {
    for (const hz of [50, 200, 700, 2000, 7000]) {
      const dry = render({ route: 'multiband', mix: 0 }, { hz, rate }).l;
      for (const mix of [0.25, 0.5, 1]) {
        const wet = render({ route: 'multiband', mix }, { hz, rate }).l;
        expect(difference(late(wet), late(dry))).toBeLessThan(1e-6);
      }
      expect(rms(dry.slice(-rate / 10))).toBeCloseTo(0.1 / Math.SQRT2, 3);
    }
  },
  20000,
);
it.each(DRIVE_ROUTES)(
  '%s preserves clean mono, and bypass returns the exact original samples',
  (route) => {
    const a = render({ route, enabled: false });
    expect(a.l).toEqual(a.r);
    a.l.forEach((x, i) =>
      expect(x).toBe(Math.fround(0.1 * Math.sin((2 * Math.PI * 440 * i) / 48000))),
    );
    const mono = render({ route });
    expect(mono.l).toEqual(mono.r);
  },
);
it('serial and parallel blend endpoints have the specified signal order', () => {
  const a = stage({ shaping: true, shaper: 'diode', amount: 0.7 });
  const b = stage({ filtering: true, filter: 'lowpass', frequency: 800 });
  const single = render({ stages: [a, b, stage()] }).l;
  expect(render({ route: 'serial', blend: 0, stages: [a, b, stage()] }).l).toEqual(single);
  expect(render({ route: 'parallel', blend: 0, stages: [a, b, stage()] }).l).toEqual(single);
  const second = render({ stages: [b, stage(), stage()] }).l;
  expect(
    difference(render({ route: 'parallel', blend: 1, stages: [a, b, stage()] }).l, second),
  ).toBeLessThan(1e-8);
  expect(
    difference(render({ route: 'serial', blend: 1, stages: [a, b, stage()] }).l, single),
  ).toBeGreaterThan(0.005);
});
it('mid/side preserves the centre while processing only stereo differences', () => {
  const side = stage({ shaping: true, shaper: 'fold', amount: 0.8, bias: 0.5 });
  const cleanMono = render({}).l;
  expect(render({ route: 'mid-side', stages: [stage(), side, stage()] }).l).toEqual(cleanMono);
  const processed = render({ route: 'mid-side', stages: [stage(), side, stage()] }, { right: -1 });
  expect(difference(processed.l, cleanMono)).toBeGreaterThan(0.01);
  expect(rms(processed.l.map((x, i) => x + processed.r[i]!))).toBeLessThan(1e-8);
});
it('isolates a low-band level edit from the upper bands', () => {
  const spec = { route: 'multiband' as const, stages: [stage({ level: -24 }), stage(), stage()] };
  expect(rms(late(render(spec, { hz: 40 }).l))).toBeLessThan(0.02);
  expect(rms(late(render(spec, { hz: 8000 }).l))).toBeCloseTo(
    rms(late(render({}, { hz: 8000 }).l)),
    3,
  );
});
it.each(DRIVE_SHAPERS)(
  '%s shapes audibly, stays finite and produces no signal from silence with bias',
  (shaper) => {
    const spec = {
      stages: [stage({ shaping: true, shaper, amount: 0.8, bias: 0.4 }), stage(), stage()],
    };
    const shaped = render(spec).l;
    expect(shaped.every(Number.isFinite)).toBe(true);
    expect(difference(shaped, render({}).l)).toBeGreaterThan(0.002);
    expect(render(spec, { amplitude: 0 }).l.every((x) => x === 0)).toBe(true);
  },
);
it('suppresses the 18 kHz alias of hard-clipped 10 kHz input', () => {
  const amount = 0.85;
  const wet = render(
    { stages: [stage({ shaping: true, shaper: 'hard', amount }), stage(), stage()] },
    { hz: 10000, amplitude: 0.5, seconds: 0.5 },
  ).l;
  const raw = Array.from({ length: wet.length }, (_, i) =>
    driveShape(0.5 * Math.sin((2 * Math.PI * 10000 * i) / 48000), 1, amount, 0),
  );
  const count = 4800;
  expect(harmonic(wet.slice(-count), 18000)).toBeLessThan(
    harmonic(raw.slice(-count), 18000) * 0.15,
  );
});
it('pre/post filtering and bias make distinct spectra; compensated tilt cancels on a clean path', () => {
  const s = stage({ shaping: true, shaper: 'diode', amount: 0.8, filtering: true, frequency: 700 });
  const pre = render({ stages: [{ ...s, pre: true }, stage(), stage()] }).l;
  const post = render({ stages: [{ ...s, pre: false }, stage(), stage()] }).l;
  expect(difference(pre, post)).toBeGreaterThan(0.002);
  const biased = render(
    { stages: [{ ...s, filtering: false, bias: 0.5 }, stage(), stage()] },
    { seconds: 0.5 },
  ).l;
  expect(harmonic(biased.slice(-4800), 880)).toBeGreaterThan(0.001);
  expect(difference(render({ tone: 12, compensation: true }).l, render({}).l)).toBeLessThan(1e-6);
});
it('envelope and LFO move the sound, and synced rate follows song tempo', () => {
  const base = stage({ shaping: true, amount: 0.5 });
  const staticSound = render({ stages: [base, stage(), stage()] }).l;
  for (const modulation of [
    { envAmount: 0.5 },
    { lfoBias: 0.8 },
    { filtering: true, envCutoff: 3, lfoCutoff: 2, frequency: 300 },
  ]) {
    expect(
      difference(render({ stages: [{ ...base, ...modulation }, stage(), stage()] }).l, staticSound),
    ).toBeGreaterThan(0.001);
  }
  const a = advancedDriveParams({ sync: true, division: '1/4' }, 120);
  const b = advancedDriveParams({ sync: false, rate: 2 });
  for (const p of [a, b]) p.s0_lfoAmount![0] = 0.5;
  const x = loadAdvancedDrive(48000, a),
    y = loadAdvancedDrive(48000, b);
  const input = [[new Float32Array(128).fill(0.1)]],
    oa = [[new Float32Array(128)]],
    ob = [[new Float32Array(128)]];
  for (let i = 0; i < 100; i++) {
    x.process(input, oa, a);
    y.process(input, ob, b);
    expect(oa).toEqual(ob);
  }
  a.bpm![0] = 60;
  for (let i = 0; i < 100; i++) {
    x.process(input, oa, a);
    y.process(input, ob, b);
  }
  expect(oa).not.toEqual(ob);
});
it('bounds rapid topology changes and releases rectified DC to silence', () => {
  const params = advancedDriveParams({
    stages: [stage({ shaping: true, shaper: 'full-wave', amount: 1 }), stage(), stage()],
  });
  const processor = loadAdvancedDrive(48000, params),
    out = [[new Float32Array(128), new Float32Array(128)]];
  const input = [[new Float32Array(128)]];
  let peak = 0,
    nonFinite = 0;
  for (let block = 0; block < 1200; block++) {
    for (let i = 0; i < 128; i++)
      input[0]![0]![i] = block < 200 ? Math.sin((block * 128 + i) * 0.1) : 0;
    if (block < 150 && block % 20 === 0) {
      params.route![0] = (block / 20) % DRIVE_ROUTES.length;
      params.s0_pre![0] = block % 40 ? 0 : 1;
    }
    processor.process(input, out, params);
    for (const x of out[0]![0]!) {
      if (!Number.isFinite(x)) nonFinite++;
      peak = Math.max(peak, Math.abs(x));
    }
  }
  expect(nonFinite).toBe(0);
  expect(peak).toBeLessThan(2);
  expect(Math.max(...out[0]![0]!.map(Math.abs))).toBeLessThan(1e-8);
  processor.port.onmessage({ data: { type: 'stop' } });
  expect(processor.process(input, out, params)).toBe(false);
}, 20000);
it('latency of the clean oversampled path equals the FIR group delay', () => {
  const p = advancedDriveParams({ stages: clean }),
    processor = loadAdvancedDrive(48000, p);
  const input = [[new Float32Array(128)]],
    out = [[new Float32Array(128)]];
  input[0]![0]![0] = 1;
  processor.process(input, out, p);
  const values = [...out[0]![0]!];
  expect(values.indexOf(Math.max(...values))).toBe(
    (DRIVE_DSP.firLength - 1) / DRIVE_DSP.oversample,
  );
});
it.each(['lowpass', 'highpass', 'bandpass', 'notch', 'peak'] as const)(
  'implements %s frequency selection',
  (filter) => {
    const s = stage({ filtering: true, filter, frequency: 1000, resonance: 2, peak: 12 });
    const gain = (hz: number): number =>
      rms(late(render({ stages: [s, stage(), stage()] }, { hz }).l)) /
      rms(late(render({}, { hz }).l));
    if (filter === 'lowpass') expect(gain(8000)).toBeLessThan(gain(100) * 0.05);
    if (filter === 'highpass') expect(gain(100)).toBeLessThan(gain(8000) * 0.05);
    if (filter === 'bandpass') {
      expect(gain(1000)).toBeGreaterThan(gain(100) * 4);
      expect(gain(1000)).toBeGreaterThan(gain(8000) * 4);
    }
    if (filter === 'notch') expect(gain(1000)).toBeLessThan(gain(100) * 0.001);
    if (filter === 'peak') expect(gain(1000)).toBeCloseTo(10 ** (s.peak / 20), 2);
  },
);
it('smooths large continuous edits and discrete route changes under sustained input', () => {
  const params = advancedDriveParams({ stages: clean }),
    fx = loadAdvancedDrive(48000, params);
  const input = [[new Float32Array(128).fill(0.1)]],
    out = [[new Float32Array(128)]];
  let previous = 0,
    jump = 0;
  for (let block = 0; block < 200; block++) {
    if (block === 40) params.drive![0] = 12;
    if (block === 80) params.route![0] = 3;
    if (block === 120) params.route![0] = 4;
    fx.process(input, out, params);
    for (const x of out[0]![0]!) {
      if (block > 20) jump = Math.max(jump, Math.abs(x - previous));
      previous = x;
    }
  }
  expect(jump).toBeLessThan(0.01);
});
it('keeps DC rejection continuous as LFO Amount crosses zero on a sustained low note', () => {
  const spec = {
    rate: 1,
    stages: [stage({ shaping: true, amount: 0, lfoAmount: 0.1 }), stage(), stage()],
  };
  const result = render(spec, { hz: 40, amplitude: 0.5, seconds: 1.5 }).l;
  let jump = 0;
  for (let i = 4800; i < result.length; i++)
    jump = Math.max(jump, Math.abs(result[i]! - result[i - 1]!));
  // A 40 Hz / 0.5 sine changes by ~0.0026 per sample; abrupt DC switching was ~0.08.
  expect(jump).toBeLessThan(0.01);
  const zero = render({ stages: [stage({ shaping: true, amount: 0 }), stage(), stage()] }).l;
  expect(zero).toEqual(render({}).l);
});
