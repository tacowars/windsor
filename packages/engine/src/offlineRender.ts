/**
 * Renders a patch to an `AudioBuffer` once, so one-shot world SFX can be played
 * as ordinary spatialised buffer sources.
 *
 * A dozen turrets each needing an independent 3D position do not need a dozen
 * worklets. Live synthesis is for music, ambience, and anything whose parameters
 * move; everything else is baked at load.
 */
import type { Patch } from './patch';
import type { ProcessorOptions } from './workletMessages';
import { PROCESSOR_NAME, WORKLET_URL } from './workletMessages';

export interface BakeOptions {
  note?: number;
  velocity?: number;
  /** Seconds the note is held. */
  duration?: number;
  /** Extra seconds rendered after release, for the tail. */
  tail?: number;
  sampleRate?: number;
}

export async function renderPatchToBuffer(
  patch: Patch,
  options: BakeOptions = {},
): Promise<AudioBuffer> {
  const { note = 60, velocity = 1, duration = 0.6, tail = 0.6, sampleRate = 48000 } = options;

  const total = duration + tail;
  const context = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
  await context.audioWorklet.addModule(WORKLET_URL);

  // The notes go in processorOptions, not through the port: postMessage is
  // asynchronous and loses the race against startRendering(), which renders the
  // whole buffer before the message would ever be delivered.
  const processorOptions: ProcessorOptions = {
    maxVoices: 4,
    patch: structuredClone(patch),
    events: [
      { type: 'noteOn', id: 1, note, velocity, frame: 0 },
      { type: 'noteOff', id: 1, frame: Math.round(duration * sampleRate) },
    ],
  };

  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions,
  });
  node.connect(context.destination);

  return await context.startRendering();
}
