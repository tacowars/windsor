/**
 * What the console remembers about one live output stage (windsor#94): the
 * clip light's latch and when the stage last acted. It listens to every
 * report through `OutputStage.subscribe`, so a frame loop slower than the
 * reports, or a Mixer tab that is hidden or re-rendered, never misses one.
 *
 * One watch per stage, kept in a `WeakMap`: the master strip's section and
 * the top-bar light read the same latch, and a rebuild's new stage starts a
 * fresh one while the old one goes with its stage.
 */
import type { OutputStage } from '@windsor/engine';
import { reportActed } from './outputStageModel';

/**
 * The slice of a stage the watch reads; a test fakes this much. Not its
 * settings: a report is judged by itself, since it may arrive after a mode
 * switch (`reportActed`).
 */
export type WatchedStage = Pick<OutputStage, 'subscribe'>;

/** The slice the meters' frame loop reads: the watch's, plus the latest report. */
export type MeteredStage = WatchedStage & Pick<OutputStage, 'revision' | 'read'>;

export interface OutputStageWatch {
  /** Set when the stage acts; cleared only by `resetLatch` (Reset peaks). */
  readonly latched: boolean;
  /** When the stage last acted, in `now()` milliseconds; `null` if it never has. */
  readonly lastActedMs: number | null;
  resetLatch(): void;
}

const watches = new WeakMap<WatchedStage, OutputStageWatch>();

/** The watch on `stage`, subscribing on first ask. */
export function watchOutputStage(
  stage: WatchedStage,
  now: () => number = () => performance.now(),
): OutputStageWatch {
  const known = watches.get(stage);
  if (known) return known;
  let latched = false;
  let lastActedMs: number | null = null;
  stage.subscribe((report) => {
    if (!reportActed(report)) return;
    latched = true;
    lastActedMs = now();
  });
  const watch: OutputStageWatch = {
    get latched() {
      return latched;
    },
    get lastActedMs() {
      return lastActedMs;
    },
    resetLatch: () => {
      latched = false;
    },
  };
  watches.set(stage, watch);
  return watch;
}

/**
 * The meters' frame key (windsor#94): the stage's report revision, or `-1`
 * with no live stage. The meters follow the audio, not the transport: the
 * audition keyboard, the metronome and the tails after Pause or Stop all
 * pass through the stage while the transport is stopped, so a new report is
 * drawn whatever the transport is doing, and idle is a silent report.
 * Asking also starts the stage's watch, so the clip light never misses one.
 */
export function meterRevision(stage: MeteredStage | null): number {
  if (!stage) return -1;
  watchOutputStage(stage);
  return stage.revision;
}
