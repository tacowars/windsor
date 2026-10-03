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
import { PEAK_METER_NAME } from '../mixer/peakMeterConstants';
import type { PeakReport } from '../mixer/peakMeterConstants';
import { generatedProcessor, inboxProcessor } from './generatedProcessor';
import type { ReverbProcessorLike } from './reverbHarness';

export interface LoadedPeakMeter {
  create(onPost: (report: PeakReport) => void): ReverbProcessorLike;
}

const scripts = new Map<number, LoadedPeakMeter>();

/** The generated meter at `sampleRate`, evaluated once per rate. */
export function loadPeakMeter(sampleRate = 48000): LoadedPeakMeter {
  const cached = scripts.get(sampleRate);
  if (cached) return cached;
  let deliver: ((report: PeakReport) => void) | null = null;
  const { Processor: ctor } = generatedProcessor<new () => ReverbProcessorLike>({
    file: 'peak-meter-processor.js',
    processor: PEAK_METER_NAME,
    sampleRate,
    base: inboxProcessor<PeakReport>(() => deliver),
  });
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
