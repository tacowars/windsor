/**
 * One offline render pass (windsor#40, split out for the stems of windsor#41):
 * the live `AudioSystem` built on an offline context of `channels` channels,
 * its opening held in the processors, driven stop by stop to the end of the
 * plan. The song render is one stereo pass; a stem render is one or more
 * wider passes, each with its taps attached (`stemTaps.ts`) before rendering
 * starts. Every pass of the same song is built and driven the same way, from
 * the same seeds, which is what lets the stem passes line up.
 *
 * Live playback is pumped by the app's timer (`AudioSystem.update`), which
 * never runs while an offline context renders. So the render drives the
 * scheduler itself: it stops the context every `RENDER_STEP_SECONDS`
 * (`suspend(t)`), issues the ticks up to `RENDER_LOOK_AHEAD_SECONDS` ahead —
 * never past the song's last bar — and resumes. At the song's end it stops
 * the transport and releases every held note, then renders the tail so
 * releases and returns ring out.
 */
import type { ArrangementDocument } from '../song/arrangementDocument';
import type { AudioSystem } from '../system/audioSystem';
import type { RenderPlan } from './renderPlan';
import { RENDER_CHANNELS, RENDER_QUANTUM_FRAMES, RENDER_STEP_SECONDS } from './renderConstants';
import type { OfflineContextLike, RenderSongOptions } from './renderSong';
import type { OpeningNotes } from './renderSystem';
import { buildSystem, captureOpening, playOpening, pumpAhead, sameOpening } from './renderSystem';

/** How one pass is laid out: its channel count, and what it wires on before rendering. */
export interface PassLayout {
  channels: number;
  /** Called once the system is built and before it plays; its return undoes the wiring. */
  attach?: (system: AudioSystem) => () => void;
}

/**
 * Render `song` (its loop already off) through `plan`: the whole context,
 * lead-in included, one array per channel. The caller trims the lead-in.
 */
export async function renderPass(
  song: ArrangementDocument,
  plan: RenderPlan,
  options: RenderSongOptions & { sampleRate: number },
  layout: PassLayout,
): Promise<AudioBuffer> {
  const { sampleRate } = options;
  const create = options.createContext ?? ((init) => new OfflineAudioContext(init));
  throwIfAborted(options.signal);
  const opening: OpeningNotes =
    song.parts.length > 0
      ? await captureOpening(
          create({ numberOfChannels: RENDER_CHANNELS, length: RENDER_QUANTUM_FRAMES, sampleRate }),
          song,
          options,
          plan,
        )
      : new Map();
  throwIfAborted(options.signal);
  const context = create({
    numberOfChannels: layout.channels,
    length: plan.totalFrames,
    sampleRate,
  });
  const system = await buildSystem(context, song, options, opening);
  let detach: (() => void) | undefined;
  try {
    detach = layout.attach?.(system);
    // The processors already hold what this play issues: drop it, once it
    // is known to be the same notes.
    if (!sameOpening(playOpening(system, song, plan), opening)) {
      throw new Error('the render opening differed between its two plays; nothing was rendered');
    }
    return await drive(context, system, plan, options);
  } finally {
    detach?.();
    system.dispose();
  }
}

/**
 * Render with a stop every step: issue the ticks due before the next stop,
 * release everything at the song's end, report progress, honour an abort.
 *
 * An abort is heard for the whole of `startRendering()`, after the last stop
 * too, and rejects at once (windsor#51 decisions 3 and 5). An offline context
 * can't be stopped, so a stop reached after an abort schedules no other and
 * resumes: the render runs on to its end over the graph `renderPass` has
 * disposed by then, settles, and lets go of its buffer.
 */
async function drive(
  context: OfflineContextLike,
  system: AudioSystem,
  plan: RenderPlan,
  options: RenderSongOptions,
): Promise<AudioBuffer> {
  const { signal, onProgress } = options;
  throwIfAborted(signal);
  let ended = false;
  const stopAt = (time: number): void => {
    void context.suspend(time).then(async () => {
      if (!signal?.aborted) {
        if (!ended) pumpAhead(system, context.currentTime, plan);
        if (!ended && context.currentTime >= plan.endSeconds) {
          ended = true;
          system.stopMusic();
        }
        onProgress?.(context.currentTime / plan.totalSeconds);
        const next = plan.nextStop(context.currentTime, RENDER_STEP_SECONDS);
        if (next !== null) stopAt(next);
        // Let the note messages reach the audio thread before it renders on.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await context.resume();
    });
  };
  // The opening is already in the processors (`playOpening`).
  const first = plan.nextStop(0, RENDER_STEP_SECONDS);
  if (first !== null) stopAt(first);
  const buffer = await untilAborted(context.startRendering(), signal);
  onProgress?.(1);
  return buffer;
}

/**
 * `work`, or an `AbortError` the moment `signal` fires: one listener for the
 * whole wait, removed when `work` settles. A `work` left behind by an abort
 * still settles later, and a rejection it settles with is swallowed here.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException('the render was cancelled', 'AbortError');
}
