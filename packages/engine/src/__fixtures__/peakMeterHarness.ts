/**
 * Runs `worklet/generated/peak-meter-processor.js` -- the bundle of
 * `worklet/meter/` (#666) -- headlessly under Node, so a fake
 * `a204-peak-meter` node reads its input the way the browser's does
 * (windsor#155). The generated text is evaluated with a stand-in for the
 * worklet scope; each processor's reports go to the `onPost` it was
 * created with, cloned as a port would.
 *
 * Node-only, by design: excluded from the engine's tsc build.
 */
// reads-by-path: packages/engine/src/worklet/generated/**
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PeakReport } from '../mixer/peakMeterConstants';
import type { ReverbProcessorLike } from './reverbHarness';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface LoadedPeakMeter {
  create(onPost: (report: PeakReport) => void): ReverbProcessorLike;
}

const scripts = new Map<number, LoadedPeakMeter>();

/** The generated meter at `sampleRate`, evaluated once per rate. */
export function loadPeakMeter(sampleRate = 48000): LoadedPeakMeter {
  const cached = scripts.get(sampleRate);
  if (cached) return cached;
  const source = readFileSync(join(HERE, '../worklet/generated/peak-meter-processor.js'), 'utf8');
  let registered: (new () => ReverbProcessorLike) | null = null;
  let deliver: ((report: PeakReport) => void) | null = null;
  class AudioWorkletProcessorShim {
    port: { postMessage(m: unknown): void; onmessage: ((e: { data: unknown }) => void) | null };
    private readonly posted: PeakReport[] = [];
    constructor() {
      const onPost = deliver;
      this.port = {
        postMessage: (m: unknown) => {
          const copy = structuredClone(m) as PeakReport;
          this.posted.push(copy);
          onPost?.(copy);
        },
        onmessage: null,
      };
    }
    inbox(message: unknown): void {
      this.port.onmessage?.({ data: message });
    }
    outbox(): PeakReport[] {
      return this.posted;
    }
  }
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source)(
    AudioWorkletProcessorShim,
    sampleRate,
    (_name: string, ctor: new () => ReverbProcessorLike) => {
      registered = ctor;
    },
  );
  const ctor = registered as unknown as new () => ReverbProcessorLike;
  const loaded: LoadedPeakMeter = {
    create(onPost) {
      deliver = onPost;
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
