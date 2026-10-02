/**
 * Renders a whole song offline (windsor#40 decision 5): the one `AudioSystem`
 * the console plays through, built on an `OfflineAudioContext` instead of the
 * page's context, so a render is the same parts, strips, returns and song
 * master as live playback and nothing here builds a node of its own.
 *
 * The pass itself — the system on the context, driven stop by stop — is
 * `renderPass.ts`, which the stem render (windsor#41) shares.
 *
 * Notes reach the processors by `postMessage`, which is asynchronous. The
 * look-ahead is twice the step, so a note posted at a stop sounds at least a
 * step later, and the context is suspended while the message travels. The
 * opening window has no such lead: its notes would be posted before rendering
 * starts. So they are never posted: each processor is built holding them
 * (`ProcessorOptions.events`), captured by playing the opening once on a
 * throwaway system first (`renderSystem.ts`).
 *
 * The scheduler places tick 0 `SCHEDULER_START_DELAY_SECONDS` after the start
 * of the context; that lead-in is rendered and trimmed, so bar 1 is the file's
 * first sample and every note lands on the frame it lands on live. The master
 * goes through the engine's output stage as set (windsor#93), and whatever
 * that stage delays it by is rendered on the end and trimmed off the head
 * too, so a master WAV starts on bar 1 in every mode.
 *
 * Every FM processor is built with a fixed seed (the render seed hashed with
 * the part's slot, decision 7), and the sequencers draw from the document's
 * own seeds, so two renders of the same song are bit-identical.
 */
import { SCHEDULER_START_DELAY_SECONDS, SECONDS_PER_MINUTE } from '../audioConstants';
import { songTicks } from '../sequencing/meter';
import { TickTransport } from '../sequencing/scheduler';
import { playableSwing } from '../sequencing/swing';
import { STRAIGHT_SWING } from '../sequencing/swingTables';
import type { ArrangementDocument } from '../song/arrangementDocument';
import type { WorkletUrls } from '../synth/fmEngine';
import { masterOutput } from '../mixer/masterSpec';
import { outputStageLatency } from '../mixer/outputStageDsp';
import type { RenderPlan } from './renderPlan';
import { planRender } from './renderPlan';
import {
  RENDER_CHANNELS,
  RENDER_MAX_FRAMES,
  RENDER_SAMPLE_RATE_DEFAULT,
  RENDER_TAIL_SECONDS,
} from './renderConstants';
import { renderPass } from './renderPass';

/** What the render needs of an offline context; `OfflineAudioContext` is one, a test fakes it. */
export interface OfflineContextLike {
  readonly sampleRate: number;
  readonly currentTime: number;
  readonly audioWorklet: { addModule(url: string): Promise<void> };
  suspend(suspendTime: number): Promise<void>;
  resume(): Promise<void>;
  startRendering(): Promise<AudioBuffer>;
}

export interface OfflineContextInit {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
}

export interface RenderSongOptions {
  sampleRate?: number;
  /** Seconds after the last bar, clamped to `RENDER_TAIL_SECONDS`. */
  tailSeconds?: number;
  /** The seed the parts' processors are pinned to; the shipped one when absent. */
  seed?: number;
  /** Aborting rejects the render with an `AbortError` and returns no audio. */
  signal?: AbortSignal;
  /** The fraction rendered so far, 0–1, at every stop. */
  onProgress?: (fraction: number) => void;
  /** Where the worklets load from; the engine's own URLs when absent, as live. */
  workletUrls?: WorkletUrls;
  /** Builds the context; a real `OfflineAudioContext` when absent (the test seam). */
  createContext?: (init: OfflineContextInit) => OfflineContextLike;
}

export interface RenderedSong {
  /**
   * One array per channel, left then right: the song from bar 1, then the
   * tail. Views into the rendered buffer, not copies.
   */
  channels: Float32Array[];
  sampleRate: number;
  /** The song's own length, before the tail. */
  songSeconds: number;
}

/** The song's length in seconds: its bars at its tempo (swing moves off-beats, never a beat). */
export function songSeconds(document: ArrangementDocument): number {
  const { bpm, bars, swing } = document.transport;
  const clock = new TickTransport(bpm, playableSwing(swing ?? STRAIGHT_SWING));
  return clock.swungTicks(songTicks(bars)) * clock.secondsPerTick;
}

/** The frame plan a render of `document` with `options` would take; allocates nothing. */
export function planFor(
  document: ArrangementDocument,
  options: Pick<RenderSongOptions, 'sampleRate' | 'tailSeconds'>,
): RenderPlan {
  const sampleRate = options.sampleRate ?? RENDER_SAMPLE_RATE_DEFAULT;
  const tail = Math.min(
    RENDER_TAIL_SECONDS.max,
    Math.max(RENDER_TAIL_SECONDS.min, options.tailSeconds ?? RENDER_TAIL_SECONDS.default),
  );
  return planRender({
    sampleRate,
    leadSeconds: SCHEDULER_START_DELAY_SECONDS,
    songSeconds: songSeconds(document),
    tailSeconds: tail,
    latencyFrames: outputStageLatency(masterOutput(document.master), sampleRate),
  });
}

/**
 * Why a render of `document` would be refused, or null. A render holds the
 * whole song as float PCM in the offline context and then the encoded file,
 * so past `RENDER_MAX_FRAMES` the tab could run out of memory. The check
 * allocates nothing: the console calls it before opening a save picker, and
 * `renderSong` before it builds a context.
 */
export function renderRefusal(
  document: ArrangementDocument,
  options: Pick<RenderSongOptions, 'sampleRate' | 'tailSeconds'> = {},
  maxFrames: number = RENDER_MAX_FRAMES,
): string | null {
  const plan = planFor(document, options);
  if (plan.totalFrames <= maxFrames) return null;
  const rate = options.sampleRate ?? RENDER_SAMPLE_RATE_DEFAULT;
  const minutes = (frames: number, at: number): string =>
    (frames / at / SECONDS_PER_MINUTE).toFixed(1);
  return (
    `the song and its tail run ${minutes(plan.totalFrames, rate)} minutes, longer than the ` +
    `${minutes(maxFrames, rate)} minutes a render can hold at this sample rate — choose a ` +
    'lower sample rate, a shorter tail, fewer bars or a faster tempo'
  );
}

export async function renderSong(
  document: ArrangementDocument,
  options: RenderSongOptions = {},
): Promise<RenderedSong> {
  const sampleRate = options.sampleRate ?? RENDER_SAMPLE_RATE_DEFAULT;
  const refusal = renderRefusal(document, options);
  if (refusal) throw new RangeError(refusal);
  const plan = planFor(document, options);
  const buffer = await renderPass(
    wholeSong(document),
    plan,
    { ...options, sampleRate },
    { channels: RENDER_CHANNELS },
  );
  return {
    channels: Array.from({ length: RENDER_CHANNELS }, (_, c) =>
      // A view past the lead-in and the stage's latency, not a copy: the song is held once.
      buffer.getChannelData(c).subarray(plan.masterStart, plan.masterStart + plan.outputFrames),
    ),
    sampleRate,
    songSeconds: plan.songFrames / sampleRate,
  };
}

/**
 * The document a whole-song render plays: the same song with its loop
 * switched off. A loop that is on wraps the transport, which would repeat the
 * loop and drop every bar outside it. A copy, so the open song keeps its loop.
 */
export function wholeSong(document: ArrangementDocument): ArrangementDocument {
  const { loop } = document.transport;
  if (!loop?.on) return document;
  return { ...document, transport: { ...document.transport, loop: { ...loop, on: false } } };
}
