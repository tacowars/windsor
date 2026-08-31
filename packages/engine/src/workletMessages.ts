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
}

/** The `AudioContext` timeline is frames at the sample rate, so this is exact. */
export function frameForTime(context: BaseAudioContext, time: number): number {
  return Math.max(0, Math.round(time * context.sampleRate));
}

/** Where the DSP lives. No imports in that file, so Vite emits it as an asset. */
export const WORKLET_URL = new URL('./worklet/fm-processor.js', import.meta.url);

export const PROCESSOR_NAME = 'fm-part';
