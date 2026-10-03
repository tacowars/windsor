/**
 * Reads one of `worklet/generated/*-processor.js` and evaluates it under Node
 * with stand-ins for the three names an `AudioWorkletGlobalScope` gives it:
 * `AudioWorkletProcessor`, `sampleRate` and `registerProcessor`
 * (windsor#503). Every worklet harness loads its bundle through here.
 *
 * Node-only, by design: excluded from the engine's tsc build (see
 * packages/engine/tsconfig.json) so browser code cannot reach it.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { readFileSync } from 'node:fs';

/**
 * The processor base most harnesses give the bundle: a port that clones what
 * it posts, as the real port does, keeps it in `posted`, and has an
 * `onmessage` for the test to call.
 */
export class PortedProcessor {
  port = {
    posted: [] as unknown[],
    onmessage: null,
    postMessage(message: unknown): void {
      this.posted.push(structuredClone(message));
    },
  };
}

/**
 * A processor base with a test door onto its port: `inbox(message)` arrives
 * as the port's `onmessage`, and `outbox()` is everything the processor
 * posted, cloned as the real port clones (a load report is one reused
 * object). `deliverTo` is read as each processor is constructed; a post also
 * goes to the callback it returned then, if any.
 */
export function inboxProcessor<M = unknown>(
  deliverTo: () => ((message: M) => void) | null = () => null,
): new () => { inbox(message: unknown): void; outbox(): M[] } {
  return class InboxProcessor {
    port: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null };
    readonly #posted: M[] = [];

    constructor() {
      const onPost = deliverTo();
      this.port = {
        postMessage: (m: unknown) => {
          const copy = structuredClone(m) as M;
          this.#posted.push(copy);
          onPost?.(copy);
        },
        onmessage: null,
      };
    }

    inbox(message: unknown): void {
      this.port.onmessage?.({ data: message });
    }

    outbox(): M[] {
      return this.#posted;
    }
  };
}

/** Each parameter's first value: what a processor's `parameterData` option takes. */
export function firstValues(params: Record<string, Float32Array>): Record<string, number> {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, value[0]!]));
}

export interface GeneratedProcessorOptions {
  /** The bundle's file name in `worklet/generated/`, such as `delay-processor.js`. */
  file: string;
  /** What the bundle reads as `sampleRate`. */
  sampleRate: number;
  /** The `AudioWorkletProcessor` the bundle's processor extends; `PortedProcessor` when omitted. */
  base?: unknown;
  /** Source run ahead of the bundle in its scope, to declare a global the bundle reads. */
  prologue?: string;
  /** Source run after the bundle in its scope; what its `return` gives comes back as `exports`. */
  epilogue?: string;
}

export interface GeneratedProcessor<P, E> {
  /** The class the bundle passed to `registerProcessor`. */
  Processor: P;
  /** What the epilogue returned; `undefined` without one. */
  exports: E;
}

const sources = new Map<string, string>();

/** The bundle's text, read once per file. */
function bundleSource(file: string): string {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const source = readFileSync(new URL(`../worklet/generated/${file}`, import.meta.url), 'utf8');
  sources.set(file, source);
  return source;
}

/** Evaluate the bundle once; throws if it registers no processor. */
export function generatedProcessor<P, E = undefined>(
  options: GeneratedProcessorOptions,
): GeneratedProcessor<P, E> {
  const { file, sampleRate, base = PortedProcessor, prologue = '', epilogue = '' } = options;
  let registered: P | undefined;
  const registerProcessor = (_name: string, cls: P): void => {
    registered = cls;
  };
  const evaluate = new Function(
    'AudioWorkletProcessor',
    'sampleRate',
    'registerProcessor',
    `${prologue}\n${bundleSource(file)}\n${epilogue}`,
  ) as (base: unknown, rate: number, register: typeof registerProcessor) => E;
  const exports = evaluate(base, sampleRate, registerProcessor);
  if (registered === undefined) throw new Error(`${file} did not call registerProcessor`);
  return { Processor: registered, exports };
}
