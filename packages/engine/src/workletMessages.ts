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

/**
 * Turn the audio-load sampler on in a processor (#445). Sent once, after the
 * node is built; a processor that never receives it never times anything and
 * never posts, which is how offline renders (`offlineRender.ts`) and the Node
 * harness stay silent instruments.
 *
 * `quanta` is how many render quanta one report covers — the main thread's
 * `AUDIO_LOAD_REPORT_SECONDS` converted with the live sample rate, because the
 * processor has no wall clock with which to measure a second.
 */
export interface ReportLoadMessage {
  type: 'reportLoad';
  quanta: number;
}

export type WorkletMessage = ScheduledMessage | PatchMessage | ControlMessage | ReportLoadMessage;

/**
 * One processor's audio-thread cost over the interval just ended (#445) — the
 * only message that travels worklet → main, and the reason this union exists
 * beside `WorkletMessage`, which is main → worklet by construction.
 *
 * ## Why counters and not a duration
 *
 * Neither measurement the platform would ideally give us exists in Chrome 152
 * (probed 2026-09-11, `docs/research/2026-09-11-445-audio-bench-arm/`):
 * `AudioContext.renderCapacity` is absent, flagged builds included, and
 * `AudioWorkletGlobalScope` exposes no `performance.now()`. The only clock the
 * scope has is `Date.now()`, at one-millisecond resolution against a 2.9 ms
 * quantum budget — so the processor does not time a call, it **samples a duty
 * cycle**: `busyMs` counts the integer-millisecond boundaries that fell inside
 * a `process()` call, which over an interval estimates the wall time the audio
 * thread spent inside that processor. `audioLoad.ts` turns these into
 * percentages and states what they are worth.
 *
 * Every field is an integer accumulated in the processor's own fields; the
 * post happens once per interval, never per quantum, and `process()` still
 * allocates nothing.
 */
export interface LoadReportMessage {
  type: 'load';
  /** Millisecond boundaries that fell inside `process()` during the interval. */
  busyMs: number;
  /** Wall milliseconds the interval spanned, `Date.now()` end to end. */
  wallMs: number;
  /** Render quanta in the interval. */
  quanta: number;
  /** Worst single quantum's measured span, ms — 1 ms resolution, so a lower bound. */
  peakMs: number;
  /**
   * Cumulative since the processor started: quanta whose measured span reached
   * the whole quantum budget, i.e. that provably could not have met their
   * render deadline. Cumulative rather than per-interval so a dropped post
   * never loses one.
   */
  underruns: number;
}

/** Everything a processor may post back. One member today; a union so the next lands here. */
export type ProcessorMessage = LoadReportMessage;

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
