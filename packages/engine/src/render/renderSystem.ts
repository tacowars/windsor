/**
 * The live `AudioSystem` built on an offline context for a song render
 * (windsor#40), and its opening: the notes the scheduler issues before
 * rendering starts.
 *
 * A note reaches a processor by `postMessage`, which is asynchronous: once
 * rendering runs, a message posted before it may arrive late, and an offline
 * context renders its first blocks long before then. So the opening's notes
 * can't be posted. They go to each processor at construction
 * (`ProcessorOptions.events`), the one path the processor reads before its
 * first block.
 *
 * The notes don't exist until the transport runs, and the transport needs
 * the parts to exist, so the render plays the opening twice. First on a
 * throwaway system (`captureOpening`) with every part holding its notes
 * instead of posting them; then the real system is built with those notes
 * inside its processors, and plays the same opening with its parts holding
 * again (`playOpening`), so the sequencers and the parts' note handles move
 * on exactly as live — and what it held is dropped, since its processors
 * already have it. Both plays are the same seeded, clock-driven code from the
 * same start time, so they issue the same notes; the render checks that
 * (`sameOpening`).
 *
 * Automation needs no such detour (windsor#344): an AudioParam event is
 * written on the main thread's timeline at once. `initMusic` holds every
 * lane at the tick the transport rests on, `setValueAtTime(v, 0)` on the
 * offline context, so the opening values are in place when `buildSystem`
 * returns, before `startRendering`; from there the automation player
 * schedules through the same pumped clock, stems included.
 */
import { hashSeed } from '../sequencing/generatorSeed';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import type { ScheduledMessage } from '../synth/workletMessages';
import { AudioSystem } from '../system/audioSystem';
import { RENDER_LOOK_AHEAD_SECONDS, RENDER_SEED_DEFAULT } from './renderConstants';
import type { RenderPlan } from './renderPlan';
import type { OfflineContextLike, RenderSongOptions } from './renderSong';

/** The opening's note messages, by engine part name. */
export type OpeningNotes = ReadonlyMap<string, ScheduledMessage[]>;

/**
 * The live system on the offline context, the song loaded but not started,
 * every part's processor seeded and — given `opening` — built holding its
 * opening notes.
 */
export async function buildSystem(
  context: OfflineContextLike,
  document: ArrangementDocument,
  options: Pick<RenderSongOptions, 'seed' | 'workletUrls'>,
  opening: OpeningNotes | null,
): Promise<AudioSystem> {
  const seed = options.seed ?? RENDER_SEED_DEFAULT;
  const seeds = new Map(document.parts.map((p) => [musicPartName(p.slot), hashSeed(seed, p.slot)]));
  // The engine reads only the `BaseAudioContext` surface an offline context
  // shares; `unlock()` — the one `AudioContext`-only call — is never made.
  const engine = new FmEngine(context as unknown as AudioContext);
  await engine.init(options.workletUrls);
  const system = new AudioSystem(engine, {
    partSeed: (name) => seeds.get(name) ?? seed,
    ...(opening ? { partEvents: (name: string) => opening.get(name) } : {}),
    defer: (run) => run(),
    // No processor samples its own timing during an export (windsor#51).
    meterLoad: false,
  });
  await system.init();
  // A song with no parts renders the standing graph: silence of the song's length.
  if (document.parts.length > 0) system.initMusic(document);
  return system;
}

/** Issue the ticks due up to the look-ahead past `now`, never past the song's last bar. */
export function pumpAhead(system: AudioSystem, now: number, plan: RenderPlan): void {
  const ahead = Math.min(RENDER_LOOK_AHEAD_SECONDS, plan.endSeconds - now);
  if (ahead <= 0) return;
  system.scheduler.lookAhead = ahead;
  system.update(0);
}

/**
 * Start the transport and issue the opening with every part holding its
 * notes; hand back what each held. The system is left running, its parts
 * posting again.
 */
export function playOpening(
  system: AudioSystem,
  document: ArrangementDocument,
  plan: RenderPlan,
): Map<string, ScheduledMessage[]> {
  const parts = document.parts.flatMap((p) => {
    const name = musicPartName(p.slot);
    const part = system.engine.getPart(name);
    return part ? [{ name, part }] : [];
  });
  for (const { part } of parts) part.holdNotes();
  system.startMusic();
  pumpAhead(system, 0, plan);
  return new Map(parts.map(({ name, part }) => [name, part.takeHeldNotes()]));
}

/**
 * The opening's notes, from a throwaway system on `probe` — a context that
 * never renders, at the render's sample rate, so every note is stamped with
 * the frame it will sound on.
 */
export async function captureOpening(
  probe: OfflineContextLike,
  document: ArrangementDocument,
  options: Pick<RenderSongOptions, 'seed' | 'workletUrls'>,
  plan: RenderPlan,
): Promise<OpeningNotes> {
  const system = await buildSystem(probe, document, options, null);
  try {
    return playOpening(system, document, plan);
  } finally {
    system.dispose();
  }
}

/** Whether two plays of the opening issued the same notes to the same parts. */
export function sameOpening(a: OpeningNotes, b: OpeningNotes): boolean {
  return JSON.stringify([...a]) === JSON.stringify([...b]);
}
