/**
 * Renders a whole song offline (windsor#40 decision 5): the one `AudioSystem`
 * the console plays through, built on an `OfflineAudioContext` instead of the
 * page's context, so a render is the same parts, strips, returns and song
 * master as live playback and nothing here builds a node of its own.
 *
 * Live playback is pumped by the app's timer (`AudioSystem.update`), which
 * never runs while an offline context renders. So the render drives the
 * scheduler itself: it stops the context every `RENDER_STEP_SECONDS`
 * (`suspend(t)`), issues the ticks up to `RENDER_LOOK_AHEAD_SECONDS` ahead —
 * never past the song's last bar — and resumes. At the song's end it stops
 * the transport and releases every held note, then renders the tail so
 * releases and returns ring out.
 *
 * Notes reach the processors by `postMessage`, which is asynchronous. The
 * look-ahead is twice the step, so a note posted at a stop sounds at least a
 * step later, and the context is suspended while the message travels. The
 * opening window has no such lead: its notes are posted before rendering
 * starts, so the render waits for a round trip through the audio thread
 * (`drainPostedMessages`) before it calls `startRendering()`.
 *
 * The scheduler places tick 0 `SCHEDULER_START_DELAY_SECONDS` after the start
 * of the context; that lead-in is rendered and trimmed, so bar 1 is the file's
 * first sample and every note lands on the frame it lands on live.
 *
 * Every FM processor is built with a fixed seed (the render seed hashed with
 * the part's slot, decision 7), and the sequencers draw from the document's
 * own seeds, so two renders of the same song are bit-identical.
 */
import { SCHEDULER_START_DELAY_SECONDS, SECONDS_PER_MINUTE } from '../audioConstants';
import { hashSeed } from '../sequencing/generatorSeed';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { playableSwing } from '../sequencing/swing';
import { STRAIGHT_SWING } from '../sequencing/swingTables';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import type { WorkletUrls } from '../synth/fmEngine';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';
import type { RenderPlan } from './renderPlan';
import { planRender } from './renderPlan';
import {
  RENDER_CHANNELS,
  RENDER_LOOK_AHEAD_SECONDS,
  RENDER_MAX_FRAMES,
  RENDER_SAMPLE_RATE_DEFAULT,
  RENDER_SEED_DEFAULT,
  RENDER_STEP_SECONDS,
  RENDER_TAIL_SECONDS,
} from './renderConstants';

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

/** The song's length in seconds: its bars at its tempo (swing moves off-beats, never bar lines). */
export function songSeconds(document: ArrangementDocument): number {
  const { bpm, bars, swing } = document.transport;
  const clock = new TickTransport(bpm, playableSwing(swing ?? STRAIGHT_SWING));
  return clock.swungTicks(bars * TICKS_PER_BAR) * clock.secondsPerTick;
}

/** The frame plan a render of `document` with `options` would take; allocates nothing. */
function planFor(
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
  throwIfAborted(options.signal);
  const create = options.createContext ?? ((init) => new OfflineAudioContext(init));
  const context = create({
    numberOfChannels: RENDER_CHANNELS,
    length: plan.totalFrames,
    sampleRate,
  });
  const system = await buildSystem(context, wholeSong(document), options);
  try {
    const buffer = await drive(context, system, plan, options);
    return {
      channels: Array.from({ length: RENDER_CHANNELS }, (_, c) =>
        // A view past the lead-in, not a copy: the song is held once.
        buffer.getChannelData(c).subarray(plan.leadFrames),
      ),
      sampleRate,
      songSeconds: plan.songFrames / sampleRate,
    };
  } finally {
    system.dispose();
  }
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

/** The live system on the offline context, the song loaded, every part's processor seeded. */
async function buildSystem(
  context: OfflineContextLike,
  document: ArrangementDocument,
  options: RenderSongOptions,
): Promise<AudioSystem> {
  const seed = options.seed ?? RENDER_SEED_DEFAULT;
  const seeds = new Map(document.parts.map((p) => [musicPartName(p.slot), hashSeed(seed, p.slot)]));
  // The engine reads only the `BaseAudioContext` surface an offline context
  // shares; `unlock()` — the one `AudioContext`-only call — is never made.
  const engine = new FmEngine(context as unknown as AudioContext);
  await engine.init(options.workletUrls);
  const system = new AudioSystem(engine, {
    partSeed: (name) => seeds.get(name) ?? seed,
    defer: (run) => run(),
  });
  await system.init();
  // A song with no parts renders the standing graph: silence of the song's length.
  if (document.parts.length > 0) {
    system.initMusic(document);
    system.startMusic();
  }
  return system;
}

/**
 * Render with a stop every step: issue the ticks due before the next stop,
 * release everything at the song's end, report progress, honour an abort.
 */
async function drive(
  context: OfflineContextLike,
  system: AudioSystem,
  plan: RenderPlan,
  options: RenderSongOptions,
): Promise<AudioBuffer> {
  const { signal, onProgress } = options;
  let ended = false;
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const pump = (): void => {
    const now = context.currentTime;
    const ahead = Math.min(RENDER_LOOK_AHEAD_SECONDS, plan.endSeconds - now);
    if (!ended && ahead > 0) {
      system.scheduler.lookAhead = ahead;
      system.update(0);
    }
  };
  const stopAt = (time: number): void => {
    void context.suspend(time).then(async () => {
      if (signal?.aborted) return rejectAbort(abortError());
      pump();
      if (!ended && context.currentTime >= plan.endSeconds) {
        ended = true;
        system.stopMusic();
      }
      onProgress?.(context.currentTime / plan.totalSeconds);
      const next = plan.nextStop(context.currentTime, RENDER_STEP_SECONDS);
      if (next !== null) stopAt(next);
      // Let the note messages reach the audio thread before it renders on.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await context.resume();
    });
  };
  pump();
  // The opening window's notes are posted before rendering starts, and an
  // offline context outruns an asynchronous postMessage
  // (`ProcessorOptions.events`): wait until the audio thread has taken them.
  await drainPostedMessages(context);
  const first = plan.nextStop(0, RENDER_STEP_SECONDS);
  if (first !== null) stopAt(first);
  const buffer = await Promise.race([context.startRendering(), aborted]);
  onProgress?.(1);
  return buffer;
}

/**
 * A round trip through the audio thread: an empty module, evaluated as a task
 * on the worklet thread queued behind every port message already posted to
 * it. Its URL is new each time, because a module map caches by URL.
 */
async function drainPostedMessages(context: OfflineContextLike): Promise<void> {
  barrierCount += 1;
  await context.audioWorklet.addModule(
    `data:text/javascript,${encodeURIComponent(`// windsor render barrier ${barrierCount}`)}`,
  );
}
let barrierCount = 0;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException('the render was cancelled', 'AbortError');
}
