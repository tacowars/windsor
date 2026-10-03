/**
 * The part meter bank's generated processor (windsor#540), run without a
 * browser: sixteen inputs fed known blocks, each read back from its own
 * stretch of the one packed report, with the strip meter's ballistics.
 */
import { describe, expect, it } from 'vitest';
import { MUSIC_PARTS_MAX } from '../audioConstants';
import { generatedProcessor, PortedProcessor } from '../__fixtures__/generatedProcessor';
import {
  PART_METER_BANK_NAME,
  PART_METER_FIELD,
  PART_METER_FIELDS,
  partMeterAckIndex,
} from './partMeterBankConstants';
import type { PartMeterBankMessage } from './partMeterBankConstants';
import { PEAK_METER, PEAK_METER_NAME } from './peakMeterConstants';
import type { PeakReport } from './peakMeterConstants';

const RATE = 48000;
const QUANTUM = 128;
/** Quanta to the first report: the strip meter's rate. */
const TO_REPORT = Math.ceil(RATE / PEAK_METER.reportHz / QUANTUM);
/** Quanta past the one-second hold. */
const PAST_HOLD = Math.ceil((RATE * PEAK_METER.holdSeconds) / QUANTUM) + TO_REPORT;

interface Processor {
  port: {
    posted: unknown[];
    onmessage: (event: { data: PartMeterBankMessage | { type: 'reset' } }) => void;
  };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

function bank(): {
  processor: Processor;
  run(quanta: number, inputs: () => Float32Array[][]): void;
  last(): Float32Array;
  slot(report: Float32Array, k: number): number[];
} {
  const { Processor } = generatedProcessor<new (options: object) => Processor>({
    file: 'peak-meter-processor.js',
    processor: PART_METER_BANK_NAME,
    sampleRate: RATE,
    base: PortedProcessor,
  });
  const processor = new Processor({ numberOfInputs: MUSIC_PARTS_MAX });
  const output = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
  return {
    processor,
    run(quanta, inputs) {
      for (let q = 0; q < quanta; q++) {
        expect(processor.process(inputs(), [output])).toBe(true);
      }
      expect(output.every((channel) => channel.every((x) => x === 0))).toBe(true);
    },
    last: () => processor.port.posted.at(-1) as Float32Array,
    slot: (report, k) =>
      Array.from(report.subarray(k * PART_METER_FIELDS, (k + 1) * PART_METER_FIELDS)),
  };
}

/** One quantum with a single sample of `value` at `at`, silence elsewhere. */
function spike(value: number, at: number): Float32Array {
  const block = new Float32Array(QUANTUM);
  block[at] = value;
  return block;
}

const silent = (): Float32Array[][] =>
  Array.from({ length: MUSIC_PARTS_MAX }, (): Float32Array[] => []);

/**
 * Input k: stereo spikes of k / 20 on the left and k / 40 below zero on the
 * right, at sample k; input 3 mono; input 7 left without channels; input 11
 * over full scale.
 */
function sixteen(): Float32Array[][] {
  return Array.from({ length: MUSIC_PARTS_MAX }, (_, k) => {
    if (k === 7) return [];
    if (k === 3) return [spike(0.3, k)];
    if (k === 11) return [spike(1.25, k), spike(-0.5, k)];
    return [spike(k / 20, k), spike(-k / 40, k)];
  });
}

const fround = Math.fround;

describe('the part meter bank processor', () => {
  it('reads each of sixteen inputs into its own report, silent inputs as zero', () => {
    const { run, last, slot, processor } = bank();
    const block = sixteen();
    run(1, () => block);
    run(TO_REPORT, silent);
    expect(processor.port.posted).toHaveLength(1);
    const report = last();
    expect(report).toHaveLength(MUSIC_PARTS_MAX * PART_METER_FIELDS + 1);
    for (let k = 0; k < MUSIC_PARTS_MAX; k++) {
      const [left, right] =
        k === 7 ? [0, 0] : k === 3 ? [0.3, 0.3] : k === 11 ? [1.25, 0.5] : [k / 20, k / 40];
      const peaks = [fround(left), fround(right)];
      expect(slot(report, k), `input ${k}`).toEqual([...peaks, ...peaks, k === 11 ? 1 : 0]);
    }
  });

  it('holds a peak for a second, then lets it fall, and keeps the latch', () => {
    const { run, last, slot } = bank();
    const block = sixteen();
    run(1, () => block);
    run(TO_REPORT * 2, silent);
    // The running peak starts over at each report; the hold stays.
    expect(slot(last(), 4)).toEqual([0, 0, fround(0.2), fround(0.1), 0]);
    expect(last()[11 * PART_METER_FIELDS + PART_METER_FIELD.overload]).toBe(1);
    run(PAST_HOLD, silent);
    expect(slot(last(), 4)).toEqual([0, 0, 0, 0, 0]);
    expect(slot(last(), 11)).toEqual([0, 0, 0, 0, 1]);
  });

  it('resets a latch, clears a detached slot and acknowledges each, touching no other slot', () => {
    const { run, last, slot, processor } = bank();
    const block = sixteen();
    run(1, () => block);
    processor.port.onmessage({ data: { type: 'reset', slot: 11, seq: 1 } });
    processor.port.onmessage({ data: { type: 'clear', slot: 5, seq: 2 } });
    run(TO_REPORT, silent);
    const report = last();
    expect(report[partMeterAckIndex(MUSIC_PARTS_MAX)]).toBe(2);
    // The reset keeps the running peak, as the strip meter's does; the clear does not.
    expect(slot(report, 11)).toEqual([fround(1.25), fround(0.5), 0, 0, 0]);
    expect(slot(report, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(slot(report, 6)).toEqual([fround(0.3), fround(0.15), fround(0.3), fround(0.15), 0]);
  });

  it('reads what the strip meter reads, report for report', () => {
    const { Processor: Strip } = generatedProcessor<new () => Processor>({
      file: 'peak-meter-processor.js',
      processor: PEAK_METER_NAME,
      sampleRate: RATE,
      base: PortedProcessor,
    });
    const strip = new Strip();
    const { run, processor, slot } = bank();
    let seed = 1;
    const noise = (scale: number): Float32Array =>
      Float32Array.from({ length: QUANTUM }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed / 2 ** 32 - 0.5) * scale;
      });
    const inputs = silent();
    const output = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
    for (let q = 0; q < 4 * PAST_HOLD; q++) {
      // Loud and soft passages, over full scale now and then, mono and silent gaps.
      const phase = Math.floor(q / 97) % 5;
      const scale = [0.4, 2.5, 0.05, 0, 1][phase]!;
      const feed = phase === 3 ? [] : phase === 4 ? [noise(scale)] : [noise(scale), noise(scale)];
      if (q % 701 === 700) {
        strip.port.onmessage({ data: { type: 'reset' } });
        processor.port.onmessage({ data: { type: 'reset', slot: 9, seq: q } });
      }
      inputs[9] = feed;
      strip.process([feed], output);
      run(1, () => inputs);
    }
    const reports = strip.port.posted as PeakReport[];
    expect(reports.length).toBeGreaterThan(100);
    expect(processor.port.posted).toHaveLength(reports.length);
    reports.forEach((r, i) => {
      const fields = [r.left, r.right, r.holdLeft, r.holdRight, Number(r.overload)];
      expect(slot(processor.port.posted[i] as Float32Array, 9), `report ${i}`).toEqual(fields);
    });
  });

  it('stops for good on stop', () => {
    const { processor } = bank();
    processor.port.onmessage({ data: { type: 'stop' } });
    expect(processor.process(silent(), [[new Float32Array(QUANTUM)]])).toBe(false);
  });
});
