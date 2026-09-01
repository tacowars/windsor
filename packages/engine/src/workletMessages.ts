/**
 * The message contract between the main thread and `worklet/fm-processor.js`.
 *
 * `frame` is an absolute frame index on the `AudioContext` timeline, which is
 * what makes scheduling sample-accurate: the worklet compares it against its own
 * `currentFrame` and splits the render block at the boundary. Convert a context
 * time to a frame with `frameForTime()`.
 */
import type { Patch } from './patch';

export interface NoteOnMessage {
  type: 'noteOn';
  /** Handle, unique per part; `noteOff` releases by the same value. */
  id: number;
  note: number;
  velocity: number;
  frame: number;
}

export interface NoteOffMessage {
  type: 'noteOff';
  id: number;
  frame: number;
}

export type ScheduledMessage = NoteOnMessage | NoteOffMessage;

export interface PatchMessage {
  type: 'patch';
  patch: Patch;
}

export interface ControlMessage {
  type: 'allNotesOff' | 'panic' | 'stop';
}

export type WorkletMessage = ScheduledMessage | PatchMessage | ControlMessage;

/** Options handed to the processor at construction. */
export interface ProcessorOptions {
  maxVoices: number;
  patch: Patch;
  /**
   * Notes present before the first render block. Offline renders must use this
   * rather than `postMessage`, which is asynchronous and loses the race against
   * `OfflineAudioContext.startRendering()`.
   */
  events?: ScheduledMessage[];
  /**
   * Pins the processor's one random source — free-running operator phase, the
   * per-voice noise seed and `panRandom` jitter — so a render is reproducible.
   * Omitted in the game, which gets `Math.random`: a part whose every note
   * started from the same phase would sound mechanical. The DSP tests (#78)
   * supply it; an offline bake that wants byte-identical output may too.
   */
  seed?: number;
}

/** The `AudioContext` timeline is frames at the sample rate, so this is exact. */
export function frameForTime(context: BaseAudioContext, time: number): number {
  return Math.max(0, Math.round(time * context.sampleRate));
}

/** Where the DSP lives. No imports in that file, so Vite emits it as an asset. */
export const WORKLET_URL = new URL('./worklet/fm-processor.js', import.meta.url);

export const PROCESSOR_NAME = 'fm-part';

/** The reverb DSP, a separate module so a part can load without it. */
export const REVERB_WORKLET_URL = new URL('./worklet/reverb-processor.js', import.meta.url);

export const REVERB_PROCESSOR_NAME = 'dattorro-reverb';
