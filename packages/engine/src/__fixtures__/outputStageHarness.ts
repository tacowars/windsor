/**
 * Runs `worklet/generated/output-stage-processor.js` -- the bundle of
 * `worklet/outputStage/` (windsor#93) -- headlessly under Node, the way
 * `reverbHarness.ts` runs the plate: the generated text evaluated with a
 * stand-in for the worklet scope, then driven a block at a time.
 *
 * Node-only, by design: excluded from the engine's tsc build.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OutputStageReport } from '../mixer/outputStageConstants';
import { OUTPUT_STAGE_MODES } from '../mixer/outputStageConstants';
import type { OutputStageMode } from '../mixer/outputStageConstants';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BLOCK = 128;

export interface StageDescriptor {
  name: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
}

export interface StageProcessorLike {
  /** Stand-in for a message arriving on the port. */
  inbox(message: unknown): void;
  /** Everything the processor posted, cloned as a port would. */
  outbox(): OutputStageReport[];
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    params: Record<string, Float32Array>,
  ): boolean;
}

export interface LoadedStage {
  descriptors: StageDescriptor[];
  create(onPost?: (report: OutputStageReport) => void): StageProcessorLike;
}

const scripts = new Map<number, LoadedStage>();

/** The generated processor at `sampleRate`, evaluated once per rate. */
export function loadOutputStage(sampleRate = 48000): LoadedStage {
  const cached = scripts.get(sampleRate);
  if (cached) return cached;
  const source = readFileSync(join(HERE, '../worklet/generated/output-stage-processor.js'), 'utf8');
  let registered: (new () => StageProcessorLike) | null = null;
  let deliver: ((report: OutputStageReport) => void) | null = null;
  class AudioWorkletProcessorShim {
    port: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null };
    private readonly posted: OutputStageReport[] = [];
    constructor() {
      const onPost = deliver;
      this.port = {
        postMessage: (m: unknown) => {
          const copy = structuredClone(m) as OutputStageReport;
          this.posted.push(copy);
          onPost?.(copy);
        },
        onmessage: null,
      };
    }
    inbox(message: unknown): void {
      this.port.onmessage?.({ data: message });
    }
    outbox(): OutputStageReport[] {
      return this.posted;
    }
  }
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    AudioWorkletProcessorShim,
    sampleRate,
    (_name: string, ctor: new () => StageProcessorLike) => {
      registered = ctor;
    },
  );
  const ctor = registered as unknown as (new () => StageProcessorLike) & {
    parameterDescriptors: StageDescriptor[];
  };
  const loaded: LoadedStage = {
    descriptors: ctor.parameterDescriptors,
    create(onPost) {
      deliver = onPost ?? null;
      try {
        return new ctor();
      } finally {
        deliver = null;
      }
    },
  };
  scripts.set(sampleRate, loaded);
  return loaded;
}

export interface StageSettings {
  mode: OutputStageMode;
  ceilingDb?: number;
  lookahead?: boolean;
}

/** The processor's parameter values for `settings`, as one-element arrays. */
export function stageParams(settings: StageSettings): Record<string, Float32Array> {
  return {
    mode: new Float32Array([OUTPUT_STAGE_MODES.indexOf(settings.mode)]),
    ceilingDb: new Float32Array([settings.ceilingDb ?? -1]),
    lookahead: new Float32Array([settings.lookahead ? 1 : 0]),
  };
}

export interface StageRender {
  left: Float32Array;
  right: Float32Array;
  reports: OutputStageReport[];
}

/**
 * Run `left` / `right` through a fresh processor, block by block, and hand
 * back the output and every report. `retune` may change the settings before
 * a block.
 */
export function renderStage(
  settings: StageSettings,
  left: Float32Array,
  right: Float32Array = left,
  options: { sampleRate?: number; retune?: (block: number) => StageSettings | null } = {},
): StageRender {
  const processor = loadOutputStage(options.sampleRate ?? 48000).create();
  let params = stageParams(settings);
  const blocks = Math.ceil(left.length / BLOCK);
  const outL = new Float32Array(blocks * BLOCK);
  const outR = new Float32Array(blocks * BLOCK);
  for (let b = 0; b < blocks; b++) {
    const next = options.retune?.(b);
    if (next) params = stageParams(next);
    const inL = new Float32Array(BLOCK);
    const inR = new Float32Array(BLOCK);
    inL.set(left.subarray(b * BLOCK, (b + 1) * BLOCK));
    inR.set(right.subarray(b * BLOCK, (b + 1) * BLOCK));
    const oL = new Float32Array(BLOCK);
    const oR = new Float32Array(BLOCK);
    processor.process([[inL, inR]], [[oL, oR]], params);
    outL.set(oL, b * BLOCK);
    outR.set(oR, b * BLOCK);
  }
  return {
    left: outL.subarray(0, left.length),
    right: outR.subarray(0, left.length),
    reports: processor.outbox(),
  };
}
