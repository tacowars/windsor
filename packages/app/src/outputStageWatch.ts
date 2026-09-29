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
