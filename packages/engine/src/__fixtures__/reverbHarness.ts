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
import { generatedProcessor, inboxProcessor } from './generatedProcessor';

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
  /** `false` keeps the low band's code out of the path whatever `lowDecay` (windsor#748). */
  lowBand?: boolean;
}

/** The topology constants a sleep test derives its span from, read out of the worklet. */
export interface ReverbTopology {
  maxSize: number;
  tankDelays: number[];
  maxPreDelay: number;
  sleepInputFloor: number;
  sleepOutputFloor: number;
  /** Build's tap times in seconds at Build 1, and the longest (windsor#761). */
  buildTapTime: number[];
  buildSpread: number;
}

export interface LoadedReverb {
  descriptors: ParameterDescriptor[];
  create(options?: ReverbCreateOptions): ReverbProcessorLike;
  sampleRate: number;
  topology: ReverbTopology;
}

/**
 * Load and evaluate the worklet with a stand-in global scope, at 48 kHz
 * unless a test asks for another rate (windsor#761's sample-rate checks).
 * The render helpers below read time at 48 kHz, so a plate loaded at
 * another rate is driven through `create` and `process` directly.
 */
export function loadReverb(sampleRate = SAMPLE_RATE): LoadedReverb {
  // The real scope gives every processor a port; the plate uses it for the
  // audio-load sampler (#445), so the stand-in has to have one too.
  const { Processor, exports: topology } = generatedProcessor<
    { new (options: unknown): ReverbProcessorLike; parameterDescriptors: ParameterDescriptor[] },
    ReverbTopology
  >({
    file: 'reverb-processor.js',
    sampleRate,
    base: inboxProcessor(),
    epilogue: `return {
      maxSize: MAX_SIZE,
      tankDelays: TANK_DELAYS,
      maxPreDelay: MAX_PRE_DELAY,
      sleepInputFloor: SLEEP_INPUT_FLOOR,
      sleepOutputFloor: SLEEP_OUTPUT_FLOOR,
      buildTapTime: BUILD_TAP_TIME,
      buildSpread: BUILD_SPREAD,
    };`,
  });

  return {
    descriptors: Processor.parameterDescriptors,
    create: (options = {}) => new Processor({ processorOptions: options }),
    sampleRate,
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
  /** Whether the low band ran the last block, and its lowpasses' states (windsor#748). */
  _band: boolean;
  _lowState: Float64Array;
  /** Each tank line's gain point, and the low band's extra gain on it (windsor#748). */
  _gain: Float64Array;
  _lowExtra: Float64Array;
  /** Build (windsor#761): the line, each tap's time in samples and gain, and the direct level now. */
  _buildLine: Float32Array;
  _buildTime: Float64Array;
  _buildGain: Float64Array;
  _buildDirect: Float64Array;
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

/** A single full-scale impulse at the start of block `at`, as a plate settled at its Size hears it. */
export function impulseAt(at: number): Feed {
  return (block, left, right) => {
    if (block !== at) return;
    left[0] = 1;
    right[0] = 1;
  };
}

/** One channel of an interleaved stereo render, from sample `from`. */
export function channel(samples: Float32Array, side: 0 | 1, from = 0): Float64Array {
  const out = new Float64Array(samples.length / 2 - from);
  for (let i = 0; i < out.length; i++) out[i] = samples[(from + i) * 2 + side] ?? 0;
  return out;
}

/** An RBJ second-order lowpass or highpass at `hz`, Q 1/√2, over `x` (a fresh array). */
function biquad(x: Float64Array, kind: 'lp' | 'hp', hz: number): Float64Array {
  const w = (2 * Math.PI * hz) / SAMPLE_RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / Math.SQRT2;
  const edge = kind === 'lp' ? (1 - cos) / 2 : (1 + cos) / 2;
  const b = [edge, kind === 'lp' ? 2 * edge : -2 * edge, edge].map((v) => v / (1 + alpha));
  const a1 = (-2 * cos) / (1 + alpha);
  const a2 = (1 - alpha) / (1 + alpha);
  const y = new Float64Array(x.length);
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const input = x[i] ?? 0;
    const out = b[0]! * input + z1;
    z1 = b[1]! * input - a1 * out + z2;
    z2 = b[2]! * input - a2 * out;
    y[i] = out;
  }
  return y;
}

/** The octave band around `hz`: fourth-order Linkwitz–Riley edges an half-octave either side. */
export function octaveBand(x: Float64Array, hz: number): Float64Array {
  const low = hz / Math.SQRT2;
  const high = hz * Math.SQRT2;
  return biquad(biquad(biquad(biquad(x, 'lp', high), 'lp', high), 'hp', low), 'hp', low);
}

/**
 * T30 in seconds (windsor#748): the Schroeder integral of left² + right², a
 * least-squares line through its −5 to −35 dB span, extrapolated to 60 dB.
 * NaN when the integral never reaches −35 dB in the render.
 */
export function t30(left: Float64Array, right: Float64Array): number {
  const n = left.length;
  const decay = new Float64Array(n);
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) {
    sum += (left[i] ?? 0) ** 2 + (right[i] ?? 0) ** 2;
    decay[i] = sum;
  }
  const total = decay[0] ?? 0;
  let [st, sd, stt, std, count] = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const db = 10 * Math.log10((decay[i] ?? 0) / total);
    if (db > -5) continue;
    if (db < -35) {
      const slope = (count * std - st * sd) / (count * stt - st * st);
      return -60 / slope;
    }
    const t = i / SAMPLE_RATE;
    [st, sd, stt, std, count] = [st + t, sd + db, stt + t * t, std + t * db, count + 1];
  }
  return NaN;
}
