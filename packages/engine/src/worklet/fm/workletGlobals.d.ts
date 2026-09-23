/**
 * The AudioWorkletGlobalScope, as the FM worklet's modules see it (#654).
 * `lib.dom` types the main thread's `AudioWorkletNode` but not the processor
 * side, and `@types/audioworklet` is written for a scope without `lib.dom`
 * and collides with it. So the four names the DSP reads are declared here,
 * for `fm/tsconfig.json` and for the test project's `src/**\/*.d.ts` include.
 */

/** The scope's sample rate, fixed for the context's lifetime. */
declare const sampleRate: number;
/** The frame index of the first sample of the current render quantum. */
declare const currentFrame: number;

/** One entry of `parameterDescriptors`: a k-rate or a-rate `AudioParam` the node exposes. */
interface AudioParamDescriptor {
  name: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: 'a-rate' | 'k-rate';
}

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
