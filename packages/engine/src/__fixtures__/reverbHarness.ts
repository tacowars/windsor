/**
 * Runs `worklet/generated/reverb-processor.js` -- the bundle of `worklet/reverb/`
 * (#671) -- headlessly under Node.
 *
 * Same approach and the same reasons as `workletHarness.ts`: the DSP is a pure
 * function from input samples to output samples, but it only runs inside an
 * `AudioWorkletGlobalScope`. This shims that scope so the reverb can be driven a
 * block at a time and its tail inspected.
 *
 * Node-only, by design: excluded from the engine's tsc build (see
 * packages/engine/tsconfig.json) so browser code cannot reach it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 48000;
const BLOCK = 128;

export interface ParameterDescriptor {
  name: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  automationRate: string;
}

export interface ReverbProcessorLike {
  /** Test-only door onto the port, standing in for postMessage (#445). */
  inbox(message: unknown): void;
  /** Everything the processor posted back — the load reports (#445). */
  outbox(): unknown[];
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}

/** Construction switches live playback never sets; a test flips one to build its "before" render (#547). */
export interface ReverbCreateOptions {
  /** `false` keeps the tank rendering through any length of silence. */
  sleep?: boolean;
  /** `false` runs the per-sample length and tap bookkeeping even when SIZE is still. */
  settledSkip?: boolean;
}

/** The topology constants a sleep test derives its span from, read out of the worklet. */
export interface ReverbTopology {
  maxSize: number;
  tankDelays: number[];
  maxPreDelay: number;
  sleepInputFloor: number;
  sleepOutputFloor: number;
}

export interface LoadedReverb {
  descriptors: ParameterDescriptor[];
  create(options?: ReverbCreateOptions): ReverbProcessorLike;
  sampleRate: number;
  topology: ReverbTopology;
}

/** Load and evaluate the worklet with a stand-in global scope. */
export function loadReverb(): LoadedReverb {
  const source = readFileSync(join(HERE, '../worklet/generated/reverb-processor.js'), 'utf8');

  let registered: (new (options: unknown) => ReverbProcessorLike) | null = null;

  // The real scope gives every processor a port; the plate uses it for the
  // audio-load sampler (#445), so the stand-in has to have one too.
  class AudioWorkletProcessorShim {
    port: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null };
    private readonly posted: unknown[] = [];

    constructor() {
      // Cloned, as the real port clones: the load report is one reused object.
      this.port = {
        postMessage: (m: unknown) => this.posted.push(structuredClone(m)),
        onmessage: null,
      };
    }

    inbox(message: unknown): void {
      this.port.onmessage?.({ data: message });
    }

    outbox(): unknown[] {
      return this.posted;
    }
  }

  const registerProcessor = (_name: string, cls: unknown): void => {
    registered = cls as new (options: unknown) => ReverbProcessorLike;
  };

  const factory = new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `${source}
     return {
       maxSize: MAX_SIZE,
       tankDelays: TANK_DELAYS,
       maxPreDelay: MAX_PRE_DELAY,
       sleepInputFloor: SLEEP_INPUT_FLOOR,
       sleepOutputFloor: SLEEP_OUTPUT_FLOOR,
     };`,
  ) as (
    sampleRate: number,
    base: unknown,
    register: (name: string, cls: unknown) => void,
  ) => ReverbTopology;

  const topology = factory(SAMPLE_RATE, AudioWorkletProcessorShim, registerProcessor);
  if (!registered) throw new Error('worklet did not call registerProcessor');

  const Processor = registered as unknown as {
    new (options: unknown): ReverbProcessorLike;
    parameterDescriptors: ParameterDescriptor[];
  };

  return {
    descriptors: Processor.parameterDescriptors,
    create: (options = {}) => new Processor({ processorOptions: options }),
    sampleRate: SAMPLE_RATE,
    topology,
  };
}

/**
 * The delay-line internals, for tests that need to check a read directly rather
 * than through the tank -- which diffuses a single-sample error to about 1% at
 * the output, far too little to assert on.
 */
export interface ReverbInternals {
  _buffers: Float32Array[];
  _write: Int32Array;
  _length: Float32Array;
  /** Each read leaves its sample in `_value` (windsor#227). */
  _read(index: number, offset: number): void;
  /** Reads `_offset` samples forward of the line's read point. */
  _readCubic(index: number): void;
  _value: number;
  _offset: number;
  /** Sleep state (#547). */
  _asleep: boolean;
  _sleepSpan: number;
  /** Whether the last block ran the per-sample SIZE bookkeeping (#547). */
  _stepping: boolean;
}

/** White-box access to one processor's delay lines. */
export function internals(processor: ReverbProcessorLike): ReverbInternals {
  return processor as unknown as ReverbInternals;
}

/** Writes one block of input. Called with the block index and both channels. */
export type Feed = (block: number, left: Float32Array, right: Float32Array) => void;

/**
 * Rewrites parameters before a block renders, which is how a test expresses
 * automation. The arrays handed in are the ones the processor reads, so writing
 * `values.size[0]` moves the parameter for that block and every block after.
 */
export type Automate = (block: number, values: Record<string, Float32Array>) => void;

/** Everything past the parameters a render can take (#547). */
export interface ReverbRenderOptions {
  automate?: Automate;
  create?: ReverbCreateOptions;
  /** Keep every output sample, interleaved, in `samples`. Off by default. */
  collectSamples?: boolean;
  /** Called after each block renders, with the processor, for white-box reads. */
  afterBlock?: (block: number, processor: ReverbProcessorLike) => void;
}

export interface ReverbRenderResult {
  /** Interleaved stereo when `collectSamples` was set; empty otherwise. */
  samples: Float32Array;
  /** Per-block RMS across both channels, so a tail can be traced over time. */
  trace: number[];
  peak: number;
  /** Count of non-finite samples. Any is a defect. */
  nonFinite: number;
  /** Largest sample-to-sample step in the left channel. Catches zipper clicks. */
  maxStep: number;
  /** True when the two output channels differ, as a stereo reverb's must. */
  stereo: boolean;
}

/**
 * Render `seconds` of audio, one block at a time.
 *
 * `params` are raw numbers, applied every block. Note that this bypasses the
 * clamping a real `AudioParam` does against the descriptor range -- which is
 * what lets a test drive the processor past its own limits deliberately.
 */
export function renderReverb(
  loaded: LoadedReverb,
  seconds: number,
  feed: Feed,
  params: Record<string, number> = {},
  extra: Automate | ReverbRenderOptions = {},
): ReverbRenderResult {
  const options: ReverbRenderOptions = typeof extra === 'function' ? { automate: extra } : extra;
  const { automate, afterBlock } = options;
  const processor = loaded.create(options.create);
  const values: Record<string, Float32Array> = {};
  for (const d of loaded.descriptors) {
    values[d.name] = new Float32Array([params[d.name] ?? d.defaultValue]);
  }

  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  const inL = new Float32Array(BLOCK);
  const inR = new Float32Array(BLOCK);

  const blocks = Math.round((seconds * loaded.sampleRate) / BLOCK);
  const collect = options.collectSamples === true;
  const samples = new Float32Array(collect ? blocks * BLOCK * 2 : 0);
  const trace: number[] = [];
  let peak = 0;
  let nonFinite = 0;
  let maxStep = 0;
  let stereo = false;
  let previous = 0;

  for (let b = 0; b < blocks; b++) {
    inL.fill(0);
    inR.fill(0);
    if (automate) automate(b, values);
    feed(b, inL, inR);
    outL.fill(0);
    outR.fill(0);
    processor.process([[inL, inR]], [[outL, outR]], values);

    let energy = 0;
    for (let i = 0; i < BLOCK; i++) {
      const l = outL[i] ?? 0;
      const r = outR[i] ?? 0;
      if (!Number.isFinite(l) || !Number.isFinite(r)) nonFinite++;
      if (l !== r) stereo = true;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
      // Skip the first blocks: the very first sample of a render is a step from
      // silence by definition, and says nothing about zippering.
      if (b > 4) maxStep = Math.max(maxStep, Math.abs(l - previous));
      previous = l;
      energy += l * l + r * r;
      if (collect) {
        samples[(b * BLOCK + i) * 2] = l;
        samples[(b * BLOCK + i) * 2 + 1] = r;
      }
    }
    afterBlock?.(b, processor);
    trace.push(Math.sqrt(energy / (BLOCK * 2)));
  }

  return { samples, trace, peak, nonFinite, maxStep, stereo };
}

/** Seconds until the trace falls to `floor` of its peak; the render length if never. */
export function tailSeconds(result: ReverbRenderResult, floor = 0.001): number {
  const peak = Math.max(...result.trace);
  for (let i = result.trace.length - 1; i >= 0; i--) {
    if ((result.trace[i] ?? 0) > peak * floor) return ((i + 1) * BLOCK) / SAMPLE_RATE;
  }
  return 0;
}

/** RMS of the block covering `at` seconds. */
export function rmsAt(result: ReverbRenderResult, at: number): number {
  return result.trace[Math.floor((at * SAMPLE_RATE) / BLOCK)] ?? 0;
}

/** A single full-scale impulse in block 0. */
export const impulse: Feed = (block, left, right) => {
  if (block !== 0) return;
  left[0] = 1;
  right[0] = 1;
};

/** Deterministic full-scale noise for `seconds`, then silence. */
export function noiseBurst(seconds: number): Feed {
  let seed = 12345;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  const until = Math.round((seconds * SAMPLE_RATE) / BLOCK);
  return (block, left, right) => {
    if (block >= until) return;
    for (let i = 0; i < BLOCK; i++) {
      const v = random();
      left[i] = v;
      right[i] = v;
    }
  };
}
