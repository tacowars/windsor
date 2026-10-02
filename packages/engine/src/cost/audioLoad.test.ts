/**
 * The audio-load readout (#445): the meter's arithmetic and its summation
 * across processors, and the real worklets' reporting path driven headlessly.
 */
import { describe, expect, it } from 'vitest';
import {
  AUDIO_LOAD_REPORT_SECONDS,
  AUDIO_LOAD_STALE_MS,
  RENDER_QUANTUM_FRAMES,
} from '../audioConstants';
import {
  AudioLoadMeter,
  ZERO_AUDIO_LOAD,
  meterNode,
  quantumBudgetMs,
  reportQuanta,
} from './audioLoad';
import type { LoadReportMessage } from '../synth/workletMessages';
import { loadProcessor } from '../__fixtures__/workletHarness';
import { loadReverb } from '../__fixtures__/reverbHarness';
import { makePatch } from '../patch/patch';

const SAMPLE_RATE = 48_000;

/** A report with everything zero but what the case under test sets. */
const report = (over: Partial<LoadReportMessage> = {}): LoadReportMessage => ({
  type: 'load',
  busyMs: 0,
  wallMs: 1000,
  quanta: 375,
  peakMs: 0,
  underruns: 0,
  ...over,
});

describe('the quantum budget', () => {
  it('is the render quantum at the context sample rate, not a literal', () => {
    // Expressed from the constants, so a table change moves the expectation
    // with it rather than breaking the test.
    expect(quantumBudgetMs(SAMPLE_RATE)).toBeCloseTo((RENDER_QUANTUM_FRAMES / SAMPLE_RATE) * 1000);
    // 44.1 kHz is the rate this machine's Chrome reports; the budget is smaller
    // at a higher rate, which is the whole reason it is computed and not fixed.
    expect(quantumBudgetMs(44_100)).toBeGreaterThan(quantumBudgetMs(48_000));
  });

  it('turns the report cadence into whole quanta at the live rate', () => {
    expect(reportQuanta(SAMPLE_RATE, AUDIO_LOAD_REPORT_SECONDS)).toBe(
      Math.round((AUDIO_LOAD_REPORT_SECONDS * SAMPLE_RATE) / RENDER_QUANTUM_FRAMES),
    );
    // Never zero: a cadence of zero quanta would post every quantum.
    expect(reportQuanta(SAMPLE_RATE, 0)).toBe(1);
  });
});

describe('AudioLoadMeter', () => {
  it('reads all zeros before anything reports', () => {
    expect(new AudioLoadMeter(() => 0).readout()).toEqual(ZERO_AUDIO_LOAD);
  });

  it('sums busy time across processors over the longest interval they covered', () => {
    const meter = new AudioLoadMeter(() => 0);
    meter.accept('part:kick', report({ busyMs: 30, wallMs: 1000 }), SAMPLE_RATE);
    meter.accept('part:arp', report({ busyMs: 50, wallMs: 1010 }), SAMPLE_RATE);
    meter.accept('return:room', report({ busyMs: 20, wallMs: 1000 }), SAMPLE_RATE);
    const r = meter.readout();
    // One audio thread: the processors' busy milliseconds add up, and the
    // denominator is the longest interval any of them covered.
    expect(r.loadPct).toBeCloseTo((100 / 1010) * 100);
    expect(r.processors).toBe(3);
  });

  it('takes the worst peak and the total underruns, not the last report', () => {
    const meter = new AudioLoadMeter(() => 0);
    const budget = quantumBudgetMs(SAMPLE_RATE);
    // A span of N crossings proves N-1 ms, so a peak of `budget + 1` is the
    // span that proves exactly one whole budget. Expressed from the constant,
    // never as the number it happens to be at 48 kHz.
    meter.accept('part:kick', report({ peakMs: budget + 1, underruns: 2 }), SAMPLE_RATE);
    meter.accept('part:arp', report({ peakMs: budget / 2, underruns: 0 }), SAMPLE_RATE);
    meter.accept('return:room', report({ peakMs: 0, underruns: 5 }), SAMPLE_RATE);
    const r = meter.readout();
    expect(r.peakPct).toBeCloseTo(100);
    expect(r.underruns).toBe(7);
  });

  it('never lets a one-millisecond span claim any of the budget', () => {
    const meter = new AudioLoadMeter(() => 0);
    // One crossing proves nothing at all: the render may have taken 0.001 ms
    // and merely straddled a boundary. It must read 0, not 34 %.
    meter.accept('part:kick', report({ peakMs: 1 }), SAMPLE_RATE);
    expect(meter.readout().peakPct).toBe(0);
    // Two crossings prove one millisecond of work, and no more than that.
    meter.accept('part:kick', report({ peakMs: 2 }), SAMPLE_RATE);
    expect(meter.readout().peakPct).toBeCloseTo((1 / quantumBudgetMs(SAMPLE_RATE)) * 100);
  });

  it('keeps a cumulative underrun count after the processor goes quiet', () => {
    // A window that suffered seven deadline misses suffered them; the count is
    // history, not an instantaneous reading, so staleness must not erase it
    // while the load and the peak correctly fall to zero.
    let now = 0;
    const meter = new AudioLoadMeter(() => now);
    meter.accept('part:kick', report({ busyMs: 100, peakMs: 9, underruns: 7 }), SAMPLE_RATE);
    now = AUDIO_LOAD_STALE_MS + 1;
    expect(meter.readout()).toEqual({
      loadPct: 0,
      peakPct: 0,
      underruns: 7,
      processors: 0,
    });
  });

  it('does not lose history when a processor is replaced under one id', () => {
    const meter = new AudioLoadMeter(() => 0);
    meter.accept('part:kick', report({ underruns: 9 }), SAMPLE_RATE);
    // A replacement processor starts its own cumulative count at zero.
    meter.accept('part:kick', report({ underruns: 1 }), SAMPLE_RATE);
    expect(meter.readout().underruns).toBe(9);
  });

  it("scales the peak against each processor's own sample rate", () => {
    const meter = new AudioLoadMeter(() => 0);
    // The same proven millisecond is a bigger share of the smaller budget at
    // 48 kHz. `peakMs: 3` proves 2 ms; a span of 1 proves nothing at either.
    meter.accept('a', report({ peakMs: 3 }), 48_000);
    const fast = meter.readout().peakPct;
    expect(fast).toBeGreaterThan(0);
    meter.accept('a', report({ peakMs: 3 }), 44_100);
    expect(meter.readout().peakPct).toBeLessThan(fast);
  });

  it("replaces a processor's report rather than accumulating it", () => {
    const meter = new AudioLoadMeter(() => 0);
    meter.accept('part:kick', report({ busyMs: 100, wallMs: 1000 }), SAMPLE_RATE);
    meter.accept('part:kick', report({ busyMs: 10, wallMs: 1000 }), SAMPLE_RATE);
    expect(meter.readout().loadPct).toBeCloseTo(1);
    expect(meter.readout().processors).toBe(1);
  });

  it('drops a processor that has stopped reporting instead of freezing its number', () => {
    let now = 0;
    const meter = new AudioLoadMeter(() => now);
    meter.accept('part:kick', report({ busyMs: 100, wallMs: 1000 }), SAMPLE_RATE);
    now = AUDIO_LOAD_STALE_MS - 1;
    expect(meter.readout().processors).toBe(1);
    now = AUDIO_LOAD_STALE_MS + 1;
    expect(meter.readout()).toEqual(ZERO_AUDIO_LOAD);
  });
});

describe('meterNode', () => {
  it('turns reporting on through the port and counts the processor', () => {
    const meter = new AudioLoadMeter(() => 0);
    const posted: unknown[] = [];
    const port = {
      postMessage: (m: unknown) => posted.push(m),
      onmessage: null,
    } as unknown as MessagePort;
    meterNode(meter, 'part:kick', { port } as unknown as AudioNode, SAMPLE_RATE, 1);
    expect(posted).toEqual([{ type: 'reportLoad', quanta: reportQuanta(SAMPLE_RATE, 1) }]);
    expect(meter.processorCount).toBe(1);
  });

  it('silences the port it replaces, so the old processor stops overwriting', () => {
    const meter = new AudioLoadMeter(() => 0);
    const make = (): MessagePort =>
      ({ postMessage: () => {}, onmessage: null }) as unknown as MessagePort;
    const first = make();
    const second = make();
    meterNode(meter, 'part:kick', { port: first } as unknown as AudioNode, SAMPLE_RATE, 1);
    meterNode(meter, 'part:kick', { port: second } as unknown as AudioNode, SAMPLE_RATE, 1);
    expect(first.onmessage).toBeNull();
    expect(second.onmessage).not.toBeNull();
    // One id is one processor however many ports have worn it.
    expect(meter.processorCount).toBe(1);
  });

  it('detach silences the port and stops counting the processor at once (#629)', () => {
    const meter = new AudioLoadMeter(() => 0);
    const port = { postMessage: () => {}, onmessage: null } as unknown as MessagePort;
    meterNode(meter, 'part:music-3', { port } as unknown as AudioNode, SAMPLE_RATE, 1);
    meter.accept('part:music-3', report({ underruns: 3 }), SAMPLE_RATE);
    meter.detach('part:music-3');
    expect(port.onmessage).toBeNull();
    expect(meter.processorCount).toBe(0);
    expect(meter.readout().processors).toBe(0);
    // The misses are history and stay counted.
    expect(meter.readout().underruns).toBe(3);
  });

  it('leaves a native node alone — the delay return has no processor to ask', () => {
    const meter = new AudioLoadMeter(() => 0);
    meterNode(meter, 'return:echo', {} as AudioNode, SAMPLE_RATE, 1);
    expect(meter.processorCount).toBe(0);
  });
});

/**
 * The real DSP, headless. Both processors must be silent instruments until
 * `reportLoad` arrives — that is how `offlineRender.ts` and the Node harness
 * stay out of the readout — and must then post exactly once per interval.
 */
describe('the worklets report their own load', () => {
  const block = (): [Float32Array[][], Float32Array[][]] => [
    [[new Float32Array(RENDER_QUANTUM_FRAMES), new Float32Array(RENDER_QUANTUM_FRAMES)]],
    [[new Float32Array(RENDER_QUANTUM_FRAMES), new Float32Array(RENDER_QUANTUM_FRAMES)]],
  ];

  it('the FM processor posts nothing until it is asked, then once per interval', () => {
    const { create } = loadProcessor();
    const p = create(makePatch(), 4);
    const [inputs, outputs] = block();
    const params = {
      pitchBend: new Float32Array([0]),
      modWheel: new Float32Array([0]),
      gain: new Float32Array([1]),
    };
    for (let i = 0; i < 10; i++) p.process(inputs, outputs, params);
    expect(p.outbox()).toEqual([]);

    const quanta = 4;
    p.inbox({ type: 'reportLoad', quanta } as never);
    for (let i = 0; i < quanta * 3; i++) p.process(inputs, outputs, params);
    const reports = p.outbox() as LoadReportMessage[];
    // Once per interval, never per quantum — the ticket's "no allocation in
    // process()" rule in its observable form.
    expect(reports).toHaveLength(3);
    for (const r of reports) {
      expect(r.type).toBe('load');
      expect(r.quanta).toBe(quanta);
      expect(r.busyMs).toBeGreaterThanOrEqual(0);
      expect(r.wallMs).toBeGreaterThanOrEqual(0);
      expect(r.underruns).toBeGreaterThanOrEqual(0);
    }
    // Cumulative, so it never goes backwards between reports.
    expect(reports[2]?.underruns).toBeGreaterThanOrEqual(reports[0]?.underruns ?? 0);
  });

  it('the plate does the same', () => {
    const { create, descriptors } = loadReverb();
    const p = create();
    const [inputs, outputs] = block();
    const params: Record<string, Float32Array> = {};
    for (const d of descriptors) params[d.name] = new Float32Array([d.defaultValue]);
    for (let i = 0; i < 10; i++) p.process(inputs, outputs, params);
    expect(p.outbox()).toEqual([]);

    const quanta = 5;
    p.inbox({ type: 'reportLoad', quanta });
    for (let i = 0; i < quanta * 2; i++) p.process(inputs, outputs, params);
    const reports = p.outbox() as LoadReportMessage[];
    expect(reports).toHaveLength(2);
    expect(reports[0]?.quanta).toBe(quanta);
  });

  it('a message that is not reportLoad leaves the plate silent', () => {
    const { create, descriptors } = loadReverb();
    const p = create();
    const [inputs, outputs] = block();
    const params: Record<string, Float32Array> = {};
    for (const d of descriptors) params[d.name] = new Float32Array([d.defaultValue]);
    p.inbox({ type: 'panic' });
    p.inbox(null);
    for (let i = 0; i < 20; i++) p.process(inputs, outputs, params);
    expect(p.outbox()).toEqual([]);
  });
});
