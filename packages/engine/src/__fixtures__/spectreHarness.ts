/**
 * Runs the shipped Spectre bundle (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`) with only the worklet scope's globals
 * shimmed, and reaches its DSP's fields for the tests that watch the latency,
 * the switch and the sleep. Node-only, like the rest of this directory.
 *
 * The drawn cells are no params, so each params object built here carries its
 * spec's cell payload beside it (`CELLS`): `loadSpectre` hands it over at
 * construction as the insert does, and `setSpectre` posts a changed payload to
 * the processor loaded on those params, as a live edit does.
 */
import { spectreCellPayload, spectreFlatCells } from '../inserts/spectreCells';
import type { SpectreCurveCells } from '../inserts/spectreCells';
import { SPECTRE_DSP } from '../inserts/spectreConstants';
import { SPECTRE_PARAMS, spectreParameters } from '../inserts/spectreParameters';
import { DEFAULT_SPECTRE } from '../inserts/spectreSpec';
import type { SpectreSpec } from '../inserts/spectreSpec';
import { firstValues, generatedProcessor } from './generatedProcessor';

const QUANTUM = 128;

/** Each params object's cell payload, and the processor loaded on it. */
const CELLS = new WeakMap<Record<string, Float32Array>, Float32Array>();
const LOADED = new WeakMap<Record<string, Float32Array>, SpectreProcessorLike>();

/** The processor's params for `spec` over the defaults at `bpm`, its cells carried beside them. */
export function spectreParams(
  spec: Partial<SpectreSpec> = {},
  bpm: number = SPECTRE_DSP.defaultBpm,
): Record<string, Float32Array> {
  const full = { ...DEFAULT_SPECTRE, ...spec };
  // Every declared param, as Chrome hands them: the stage's own (`pitches`) at its default.
  const values = {
    ...Object.fromEntries(SPECTRE_PARAMS.map((p) => [p.name, p.defaultValue])),
    ...spectreParameters(full, bpm),
  };
  const params = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, new Float32Array([value])]),
  );
  CELLS.set(params, spectreCellPayload(full));
  return params;
}

/** Writes `spec`'s params into `params` in place, and posts its cells if they changed, as a live edit does. */
export function setSpectre(
  params: Record<string, Float32Array>,
  spec: Partial<SpectreSpec>,
  bpm: number = SPECTRE_DSP.defaultBpm,
): void {
  const full = { ...DEFAULT_SPECTRE, ...spec };
  const values = spectreParameters(full, bpm);
  for (const [key, value] of Object.entries(values)) params[key]![0] = value;
  const cells = spectreCellPayload(full);
  const before = CELLS.get(params);
  if (before && before.every((v, i) => v === cells[i])) return;
  CELLS.set(params, cells);
  LOADED.get(params)?.port.onmessage({ data: { type: 'cells', cells } });
}

export interface SpectreProcessorLike {
  port: { posted: unknown[]; onmessage(event: { data: unknown }): void };
  dsp: {
    size: number;
    hop: number;
    latency: number;
    level: number;
    fade: number;
    bypassed: boolean;
    asleep: boolean;
    quiet: number;
    quietNeeded: number;
    freeze: number;
  };
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}

export function loadSpectre(
  rate = 48000,
  params = spectreParams(),
  { sleep = true } = {},
): SpectreProcessorLike {
  const { Processor } = generatedProcessor<new (options: unknown) => SpectreProcessorLike>({
    file: 'spectre-processor.js',
    sampleRate: rate,
  });
  const processor = new Processor({
    parameterData: firstValues(params),
    processorOptions: { sleep, cells: CELLS.get(params) },
  });
  LOADED.set(params, processor);
  return processor;
}

/** A stereo signal of `frames` samples: the left `at(i)`, the right `right(i)` (the left's by default). */
export function spectreSignal(
  frames: number,
  at: (i: number) => number,
  right: (i: number) => number = at,
): Float32Array[] {
  return [
    Float32Array.from({ length: frames }, (_, i) => at(i)),
    Float32Array.from({ length: frames }, (_, i) => right(i)),
  ];
}

export interface SpectreRun {
  left: Float32Array;
  right: Float32Array;
}

/**
 * `processor` over `input` in quanta, the params as they stand, `each(q)`
 * called before quantum `q` renders. The length is rounded up to whole
 * quanta of silence.
 */
export function runSpectre(
  processor: SpectreProcessorLike,
  input: Float32Array[],
  params: Record<string, Float32Array>,
  each: (quantum: number) => void = () => {},
): SpectreRun {
  const frames = Math.ceil(input[0]!.length / QUANTUM) * QUANTUM;
  const left = new Float32Array(frames),
    right = new Float32Array(frames);
  for (let at = 0, q = 0; at < frames; at += QUANTUM, q++) {
    each(q);
    const slice = input.map((channel) => {
      const out = new Float32Array(QUANTUM);
      out.set(channel.subarray(at, at + QUANTUM));
      return out;
    });
    const out = [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
    processor.process([slice], [out], params);
    left.set(out[0]!, at);
    right.set(out[1]!, at);
  }
  return { left, right };
}

/** One curve at `value` in every cell, linked and smooth. */
export const spectreFlat = (value: number): SpectreCurveCells => ({
  left: spectreFlatCells(value),
  link: true,
  steps: false,
});

/** Curves that leave every band whole and undelayed: Spectre as a pure analysis and resynthesis. */
export const SPECTRE_TRANSPARENT: Partial<SpectreSpec> = {
  curves: { gain: spectreFlat(1), delay: spectreFlat(0), feedback: spectreFlat(0) },
  grid: 'off',
  mix: 1,
};
