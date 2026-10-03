/**
 * Runs `worklet/generated/fm-processor.js` (the bundle of `worklet/fm/`) headlessly under Node.
 *
 * The DSP is the part of the audio system most worth testing and the least
 * testable in a browser: it is a pure function from events to samples, but it
 * only runs inside an `AudioWorkletGlobalScope`. This shims that scope so the
 * processor can be driven a block at a time and its output inspected.
 *
 * Node-only, by design: excluded from the engine's tsc build (see
 * packages/engine/tsconfig.json) so browser code cannot reach it.
 */
import { generatedProcessor, inboxProcessor } from './generatedProcessor';

const SAMPLE_RATE = 48000;
const BLOCK = 128;

export interface ScheduledEvent {
  /** `allNotesOff` is what a transport stop or pause sends (windsor#7). */
  type: 'noteOn' | 'noteOff' | 'allNotesOff';
  id: number;
  note?: number;
  velocity?: number;
  frame: number;
  /** Per-note mod and the legato slide flag (#602). */
  mod?: number;
  slide?: boolean;
  /** A step's parameter offsets, one slot per `VOICE_TARGET_TABLE` row (windsor#17). */
  stepMod?: readonly number[];
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
  /** Everything the processor posted back — the load reports (#445). */
  outbox(): unknown[];
}

export interface AlgorithmTable {
  name: string;
  mods: number[][];
  carriers: number[];
}

/**
 * The seed every `create()` uses unless one is passed.
 *
 * The processor draws free-running operator phase, per-voice noise seeds and
 * pan jitter from `Math.random` in live playback. Left alone, that makes every
 * render here a different signal, and a test that asserts a level is then a
 * coin toss on the tail of the distribution — which is exactly how the
 * `bass-digital` clip assertion failed once and passed on re-run (#78). Every
 * render through this harness is therefore seeded by default. Coverage of the
 * random space belongs in an explicit sweep (`sweepPeaks`), not in one
 * unrepeatable draw per CI run.
 */
export const DEFAULT_SEED = 0xa204;

/** Construction switches live playback never sets; a test flips one to build its "before" render. */
export interface CreateOptions {
  /** `false` renders silent held voices in full, as the part did before #547. */
  dormancy?: boolean;
  /** `false` renders every voice through the generic loop, as the part did before #548. */
  specialise?: boolean;
  /**
   * The control intervals over the shipped table (windsor#326,
   * `voiceControlInterval.ts`): `long: ctrlInterval` renders every block at
   * the fine interval, as the part did before.
   */
  controlIntervals?: { long?: number; minSegmentSeconds?: number; maxLfoHz?: number };
  /** Seconds a slid note glides when the patch's `glide` is 0 (#602); the engine passes its default. */
  slideSeconds?: number;
  /** Notes present before the first block (`ProcessorOptions.events`), as an offline render builds a part. */
  events?: ScheduledEvent[];
  /** The automation slots' map from the first block (`ProcessorOptions.voiceSlots`, windsor#346). */
  voiceSlots?: (string | null)[];
}

/** The worklet's own `Envelope`, for pinning a model of it (#620): the console's curve. */
export interface EnvelopeLike {
  readonly value: number;
  readonly phase: number;
  readonly finished: boolean;
  configure(params: unknown, sampleRate: number): void;
  noteOn(): void;
  noteOff(): void;
  /** Advance by `n` samples; the new value is `value` (windsor#233). */
  advance(n: number): void;
}

export interface LoadedProcessor {
  /** `seed: null` restores live playback's `Math.random`; omitted means DEFAULT_SEED. */
  create(
    patch: unknown,
    maxVoices?: number,
    seed?: number | null,
    options?: CreateOptions,
  ): ProcessorLike;
  setFrame(frame: number): void;
  sampleRate: number;
  algorithms: AlgorithmTable[];
  waveIds: Record<string, number>;
  /** Modulation depth at operator amplitude 1, in cycles of phase (#543). */
  modIndexScale: number;
  /** Samples between control-rate updates: the length of every amplitude ramp (#547). */
  ctrlInterval: number;
  /** The envelope stage a held note settles in, `ST_SUSTAIN` (#547). */
  sustainState: number;
  /** The dormancy floors on carrier amplitude and SVF state (#547). */
  dormantAmp: number;
  dormantFilterState: number;
  /** A fresh envelope over `params` at the harness sample rate (#620). */
  envelope(params: unknown): EnvelopeLike;
  /** The floor a segment's time is held to, seconds. */
  minSegmentTime: number;
}

/** What the evaluated worklet hands back: a frame setter and the constants tests read. */
interface WorkletHandle {
  setFrame: (f: number) => void;
  ALGORITHMS: AlgorithmTable[];
  WAVE: Record<string, number>;
  MOD_INDEX_SCALE: number;
  CTRL_INTERVAL: number;
  ST_SUSTAIN: number;
  DORMANT_AMP: number;
  DORMANT_FILTER_STATE: number;
  Envelope: new () => EnvelopeLike;
  MIN_SEG_TIME: number;
}

/** Load and evaluate the worklet with a stand-in global scope. */
export function loadProcessor(): LoadedProcessor {
  const { Processor, exports: handle } = generatedProcessor<
    new (options: { processorOptions: unknown }) => ProcessorLike,
    WorkletHandle
  >({
    file: 'fm-processor.js',
    sampleRate: SAMPLE_RATE,
    base: inboxProcessor(),
    prologue: 'let currentFrame = 0;',
    epilogue: `return {
      setFrame: (f) => { currentFrame = f; },
      ALGORITHMS,
      WAVE,
      MOD_INDEX_SCALE,
      CTRL_INTERVAL,
      ST_SUSTAIN,
      DORMANT_AMP,
      DORMANT_FILTER_STATE,
      Envelope,
      MIN_SEG_TIME,
    };`,
  });

  return {
    create: (patch, maxVoices = 16, seed = DEFAULT_SEED, options = {}) =>
      new Processor({
        processorOptions: {
          maxVoices,
          patch: structuredClone(patch),
          // `null` is the deliberate opt-out; the worklet reads `== null` as
          // "no seed" and falls back to Math.random, live playback's path.
          seed: seed ?? undefined,
          ...options,
        },
      }),
    setFrame: handle.setFrame,
    sampleRate: SAMPLE_RATE,
    algorithms: handle.ALGORITHMS,
    waveIds: handle.WAVE,
    modIndexScale: handle.MOD_INDEX_SCALE,
    ctrlInterval: handle.CTRL_INTERVAL,
    sustainState: handle.ST_SUSTAIN,
    dormantAmp: handle.DORMANT_AMP,
    dormantFilterState: handle.DORMANT_FILTER_STATE,
    envelope: (params) => {
      const envelope = new handle.Envelope();
      envelope.configure(params, SAMPLE_RATE);
      return envelope;
    },
    minSegmentTime: handle.MIN_SEG_TIME,
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
