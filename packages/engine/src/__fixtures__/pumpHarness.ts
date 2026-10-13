/**
 * Runs the shipped Pump bundle (record `2026-10-13-pump-insert`) with only
 * the worklet scope's globals shimmed, and reaches its DSP's fields for the
 * tests that watch the cycle and the detector. Node-only, like the rest of
 * this directory.
 */
import { PUMP_DSP } from '../inserts/pumpConstants';
import { pumpParameters } from '../inserts/pumpParameters';
import { DEFAULT_PUMP } from '../inserts/pumpSpec';
import type { PumpSpec } from '../inserts/pumpSpec';
import { firstValues, generatedProcessor } from './generatedProcessor';

const QUANTUM = 128;

/** The processor's params for `spec` over the defaults at `bpm`, keyed externally when `external`. */
export function pumpParams(
  spec: Partial<PumpSpec> = {},
  { bpm = PUMP_DSP.defaultBpm, external = false } = {},
): Record<string, Float32Array> {
  const values = {
    ...pumpParameters({ ...DEFAULT_PUMP, ...spec }, bpm),
    external: Number(external),
  };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, new Float32Array([value])]),
  );
}

export interface PumpProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  dsp: {
    phase: number;
    phaseStep: number;
    gain: number;
    level: number;
    bypassed: boolean;
    detector: { fast: number; slow: number; armed: boolean };
  };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}

export function loadPump(rate = 48000, params = pumpParams()): PumpProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => PumpProcessorLike>({
    file: 'pump-processor.js',
    sampleRate: rate,
  });
  return new Processor({ parameterData: firstValues(params) });
}

/** A stereo signal of `frames` samples, both channels `at(i)`. */
export function pumpSignal(frames: number, at: (i: number) => number): Float32Array[] {
  const left = Float32Array.from({ length: frames }, (_, i) => at(i));
  return [left, Float32Array.from(left)];
}

export interface PumpRun {
  left: Float32Array;
  right: Float32Array;
  /** The frame index each quantum's end left the DSP's phase at, quantum by quantum. */
  phases: number[];
}

/**
 * `processor` over `program` keyed by `key` (input 1; give the params
 * `external` to hear it), in quanta, the params as they stand. The lengths
 * are rounded up to whole quanta of silence.
 */
export function runPump(
  processor: PumpProcessorLike,
  program: Float32Array[],
  params: Record<string, Float32Array>,
  key: Float32Array[] = [],
): PumpRun {
  const frames = Math.ceil(program[0]!.length / QUANTUM) * QUANTUM;
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  const phases: number[] = [];
  const slice = (channels: Float32Array[], at: number): Float32Array[] =>
    channels.map((channel) => {
      const out = new Float32Array(QUANTUM);
      out.set(channel.subarray(at, at + QUANTUM));
      return out;
    });
  for (let at = 0; at < frames; at += QUANTUM) {
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    processor.process([slice(program, at), slice(key, at)], [out], params);
    left.set(out[0]!, at);
    right.set(out[1]!, at);
    phases.push(processor.dsp.phase);
  }
  return { left, right, phases };
}

/** A kick-like key: silence, then from `onset` a 55 Hz sine that decays over about 120 ms. */
export function kick(frames: number, rate: number, onsets: readonly number[]): Float32Array[] {
  const tau = 0.12 * rate;
  return pumpSignal(frames, (i) => {
    let sum = 0;
    for (const onset of onsets) {
      if (i < onset) continue;
      const t = i - onset;
      sum += Math.sin((2 * Math.PI * 55 * t) / rate + Math.PI / 2) * Math.exp(-t / tau);
    }
    return 0.8 * sum;
  });
}
