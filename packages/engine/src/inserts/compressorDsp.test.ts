import { describe, expect, it } from 'vitest';
import { compressorParams, loadCompressor } from '../__fixtures__/compressorHarness';
import { COMPRESSOR_DSP, COMPRESSOR_RATIOS } from './compressorConstants';
import { CompressorDsp, feedbackStep } from './compressorDsp';
import type { CompressorSpec } from './compressorSpec';

function run(
  options: {
    spec?: Partial<CompressorSpec>;
    rate?: number;
    seconds?: number;
    signal?: (i: number, rate: number) => number;
    right?: number;
  } = {},
): CompressorDsp {
  const { spec = {}, rate = 48000, seconds = 1, signal = () => 1, right = 1 } = options;
  const dsp = new CompressorDsp(rate, compressorParams(spec));
  for (let i = 0; i < seconds * rate; i++) dsp.tick(signal(i, rate), right * signal(i, rate));
  return dsp;
}

describe('feedback compressor DSP', () => {
  it.each([44100, 48000, 96000])('has the requested steady-state ratio at %i Hz', (rate) => {
    for (const ratio of COMPRESSOR_RATIOS) {
      const dsp = run({ rate, spec: { threshold: -40, ratio, attack: 0.01, release: 0.1 } });
      expect(dsp.reductionDb).toBeCloseTo(40 * (1 - 1 / ratio), 3);
    }
  });
  it('solves the feedback equation on both sides and throughout the knee', () => {
    const knee = COMPRESSOR_DSP.kneeDb;
    for (const speed of [0.0001, 0.1, 2, 20])
      for (const over of [-12, -3, 0, 3, 12]) {
        const previous = 2;
        const slope = 3;
        const r = feedbackStep(over, previous, slope, speed);
        const x = over - r;
        const shape = x <= -knee / 2 ? 0 : x >= knee / 2 ? x : (x + knee / 2) ** 2 / (2 * knee);
        expect(r - previous).toBeCloseTo(speed * (slope * shape - r), 8);
      }
  });
  it('slower attack lets more of a transient through', () => {
    const fast = run({ seconds: 0.005, spec: { attack: 0.1 } });
    const slow = run({ seconds: 0.005, spec: { attack: 30 } });
    expect(fast.reductionDb).toBeGreaterThan(slow.reductionDb * 2);
  });
  it('manual release recovers, and a longer release holds reduction longer', () => {
    const fast = run({ spec: { release: 0.1 } });
    const slow = run({ spec: { release: 1.2 } });
    const held = fast.reductionDb;
    for (let i = 0; i < 24000; i++) {
      fast.tick(0, 0);
      slow.tick(0, 0);
    }
    expect(fast.reductionDb).toBeLessThan(held / 10);
    expect(slow.reductionDb).toBeGreaterThan(fast.reductionDb * 2);
  });
  it('Auto remembers sustained material more than a brief transient', () => {
    const burst = run({ seconds: 0.03, spec: { attack: 0.1, release: 0 } });
    const sustained = run({ seconds: 2, spec: { attack: 0.1, release: 0 } });
    for (let i = 0; i < 24000; i++) {
      burst.tick(0, 0);
      sustained.tick(0, 0);
    }
    expect(sustained.reductionDb).toBeGreaterThan(burst.reductionDb * 2);
    for (let i = 0; i < 48000 * 20; i++) sustained.tick(0, 0);
    expect(sustained.reductionDb).toBeLessThan(0.01);
  });
  it('changing from Auto to manual release preserves the audible envelope', () => {
    const params = compressorParams({ release: 0 });
    const dsp = new CompressorDsp(48000, params);
    for (let i = 0; i < 96000; i++) dsp.tick(1, 1);
    for (let i = 0; i < 24000; i++) dsp.tick(0, 0);
    const before = dsp.reductionDb;
    expect(before).toBeGreaterThan(1);
    params.release![0] = 0.4;
    dsp.configure(params);
    dsp.tick(0, 0);
    expect(Math.abs(dsp.reductionDb - before)).toBeLessThan(0.01);
  });
  it('links stereo without cancellation from opposite polarity or a silent channel', () => {
    const stereo = run();
    expect(run({ right: -1 }).gain).toBe(stereo.gain);
    expect(run({ right: 0 }).gain).toBe(stereo.gain);
  });
  it('the detector highpass reduces bass triggering', () => {
    const signal = (i: number, rate: number): number => Math.sin((2 * Math.PI * 40 * i) / rate);
    const full = run({ signal, spec: { highpass: 0, release: 0.4 } });
    const cut = run({ signal, spec: { highpass: 500, release: 0.4 } });
    expect(cut.reductionDb).toBeLessThan(full.reductionDb / 2);
  });
  it('Range bounds sustained reduction and zero is no compression', () => {
    expect(run({ spec: { range: 3, threshold: -40 } }).reductionDb).toBeCloseTo(3, 8);
    expect(run({ spec: { range: 0 } }).gain).toBe(1);
  });
  it('dry, bypass and makeup have their stated gain', () => {
    expect(run({ spec: { mix: 0, makeup: 24 } }).gain).toBe(1);
    expect(run({ spec: { enabled: false, makeup: 24 } }).gain).toBe(1);
    const wet = run({ spec: { mix: 1 } });
    const half = run({ spec: { mix: 0.5 } });
    expect(half.gain).toBeCloseTo((wet.gain + 1) / 2, 8);
    expect(run({ spec: { makeup: 6 } }).gain / wet.gain).toBeCloseTo(10 ** (6 / 20), 8);
  });
  it('smooths abrupt knob and bypass changes without an output step', () => {
    const params = compressorParams();
    const dsp = new CompressorDsp(48000, params);
    for (let i = 0; i < 48000; i++) dsp.tick(1, 1);
    const old = dsp.gain;
    params.enabled![0] = 0;
    params.makeup![0] = 24;
    params.threshold![0] = -40;
    dsp.configure(params);
    expect(Math.abs(dsp.tick(1, 1) - old)).toBeLessThan(0.01);
    for (let i = 0; i < 48000; i++) dsp.tick(1, 1);
    expect(dsp.gain).toBe(1);
  });
  it.each([44100, 96000])(
    'stays finite under extremes and supra-full-scale signals at %i Hz',
    (rate) => {
      const params = compressorParams({ threshold: -40, makeup: 24, ratio: 10, attack: 0.01 });
      const dsp = new CompressorDsp(rate, params);
      for (let i = 0; i < rate; i++) {
        const gain = dsp.tick((i % 2 ? -1 : 1) * 8, 0);
        expect(Number.isFinite(gain)).toBe(true);
        expect(gain).toBeLessThanOrEqual(10 ** (24 / 20));
        expect(dsp.reductionDb).toBeGreaterThanOrEqual(0);
      }
    },
  );
});

describe('shipped worklet', () => {
  const block = (): Float32Array => new Float32Array(128).fill(1);
  it('external silence stays external; the key never leaks into the output', () => {
    const params = compressorParams({ attack: 0.01 });
    params.external![0] = 1;
    const processor = loadCompressor(48000, params);
    const left = block();
    const right = block();
    const out = [[new Float32Array(128), new Float32Array(128)]];
    for (let i = 0; i < 100; i++) processor.process([[left, right], []], out, params);
    expect(out[0]![0]).toEqual(left);
    for (let i = 0; i < 100; i++) processor.process([[left, right], [block()]], out, params);
    expect(out[0]![0]![127]).toBeLessThan(0.5);
    processor.process([[], [block()]], out, params);
    expect(out[0]![0]!.every((v) => v === 0)).toBe(true);
  });
  it('handles mono and empty input, links channels, opts into telemetry and stops', () => {
    const params = compressorParams();
    const processor = loadCompressor(48000, params);
    const out = [[block(), block()]];
    processor.process([[]], out, params);
    expect(out[0]![0]!.every((v) => v === 0)).toBe(true);
    processor.process([[block()]], out, params);
    expect(out[0]![0]).toEqual(out[0]![1]);
    expect(processor.port.posted).toEqual([]);
    processor.port.onmessage({ data: { type: 'meter', enabled: true } });
    processor.port.onmessage({ data: { type: 'reportLoad', quanta: 20 } });
    for (let i = 0; i < 30; i++) processor.process([[block()]], out, params);
    expect(processor.port.posted).toContainEqual(
      expect.objectContaining({ type: 'load', quanta: 20 }),
    );
    expect(processor.port.posted).toContainEqual(
      expect.objectContaining({ type: 'reduction', db: expect.any(Number) }),
    );
    expect(processor.port.posted.length).toBeLessThan(10);
    processor.port.onmessage({ data: { type: 'stop' } });
    expect(processor.process([], out, params)).toBe(false);
  });
});
