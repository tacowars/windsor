/**
 * Runs `worklet/fm-processor.js` headlessly under Node.
 *
 * The DSP is the part of the audio system most worth testing and the least
 * testable in a browser: it is a pure function from events to samples, but it
 * only runs inside an `AudioWorkletGlobalScope`. This shims that scope so the
 * processor can be driven a block at a time and its output inspected.
 *
 * Node-only, by design: excluded from the client's tsc build (see
 * packages/client/tsconfig.json) so browser code cannot reach it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 48000;
const BLOCK = 128;

export interface ScheduledEvent {
  type: 'noteOn' | 'noteOff';
  id: number;
  note?: number;
  velocity?: number;
  frame: number;
}

export interface VoiceLike {
  active: boolean;
  fading: boolean;
  age: number;
}

export interface ProcessorLike {
  voices: VoiceLike[];
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
  /** Test-only door onto the port, standing in for postMessage. */
  inbox(message: ScheduledEvent): void;
}

export interface AlgorithmTable {
  name: string;
  mods: number[][];
  carriers: number[];
}

export interface LoadedProcessor {
  create(patch: unknown, maxVoices?: number): ProcessorLike;
  setFrame(frame: number): void;
  sampleRate: number;
  algorithms: AlgorithmTable[];
  waveIds: Record<string, number>;
}

/** Load and evaluate the worklet with a stand-in global scope. */
export function loadProcessor(): LoadedProcessor {
  const source = readFileSync(join(HERE, '../worklet/fm-processor.js'), 'utf8');

  let registered: (new (options: { processorOptions: unknown }) => ProcessorLike) | null = null;

  class AudioWorkletProcessorShim {
    port: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null };

    constructor() {
      this.port = { postMessage: () => {}, onmessage: null };
    }

    inbox(message: unknown): void {
      this.port.onmessage?.({ data: message });
    }
  }

  const registerProcessor = (_name: string, cls: unknown): void => {
    registered = cls as new (options: { processorOptions: unknown }) => ProcessorLike;
  };

  const factory = new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `let currentFrame = 0;
     ${source}
     return {
       setFrame: (f) => { currentFrame = f; },
       ALGORITHMS,
       WAVE,
     };`,
  ) as (
    sampleRate: number,
    base: unknown,
    register: (name: string, cls: unknown) => void,
  ) => {
    setFrame: (f: number) => void;
    ALGORITHMS: AlgorithmTable[];
    WAVE: Record<string, number>;
  };

  const handle = factory(SAMPLE_RATE, AudioWorkletProcessorShim, registerProcessor);
  if (!registered) throw new Error('worklet did not call registerProcessor');
  const Processor = registered as new (options: { processorOptions: unknown }) => ProcessorLike;

  return {
    create: (patch, maxVoices = 16) =>
      new Processor({ processorOptions: { maxVoices, patch: structuredClone(patch) } }),
    setFrame: handle.setFrame,
    sampleRate: SAMPLE_RATE,
    algorithms: handle.ALGORITHMS,
    waveIds: handle.WAVE,
  };
}

export interface RenderResult {
  /** Largest absolute sample across both channels. */
  peak: number;
  /** Count of non-finite samples. Any is a defect. */
  nonFinite: number;
  rms: number;
  /** Interleaved stereo, for spectral and discontinuity checks. */
  samples: Float32Array;
}

export interface RenderOptions {
  /**
   * Keep every rendered sample. On by default; the allocation test turns it off
   * because the buffer itself is megabytes and would dominate what it measures.
   */
  collectSamples?: boolean;
}

/** Render `blocks` x 128 frames, delivering events at their frame boundaries. */
export function render(
  loaded: LoadedProcessor,
  processor: ProcessorLike,
  blocks: number,
  events: ScheduledEvent[] = [],
  options: RenderOptions = {},
): RenderResult {
  const collect = options.collectSamples !== false;
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const outputs = [[left, right]];
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };

  const samples = new Float32Array(collect ? blocks * BLOCK * 2 : 0);
  let peak = 0;
  let nonFinite = 0;
  let energy = 0;
  let pending = 0;

  for (let b = 0; b < blocks; b++) {
    const start = b * BLOCK;
    loaded.setFrame(start);
    while (pending < events.length) {
      const event = events[pending];
      if (!event || event.frame >= start + BLOCK) break;
      processor.inbox(event);
      pending++;
    }
    processor.process([], outputs, params);

    for (let i = 0; i < BLOCK; i++) {
      const l = left[i] ?? 0;
      const r = right[i] ?? 0;
      if (!Number.isFinite(l) || !Number.isFinite(r)) nonFinite++;
      const magnitude = Math.max(Math.abs(l), Math.abs(r));
      if (magnitude > peak) peak = magnitude;
      energy += l * l + r * r;
      if (collect) {
        samples[(start + i) * 2] = l;
        samples[(start + i) * 2 + 1] = r;
      }
    }
  }

  return { peak, nonFinite, rms: Math.sqrt(energy / (blocks * BLOCK * 2)), samples };
}

/** Energy at one frequency, via Goertzel. Bins are ~1 Hz wide at these lengths. */
export function goertzel(samples: Float32Array, frequency: number, sampleRate: number): number {
  const n = samples.length >> 1;
  const coeff = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = (samples[i * 2] ?? 0) + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - coeff * s1 * s2)) / n;
}
