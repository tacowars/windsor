/**
 * What the console remembers about one live output stage (windsor#94): the
 * clip light's latch, what latched it, when the stage last acted, and each
 * input channel's latch above 0 dBFS (windsor#193 decision 5). It listens to
 * every report through `OutputStage.subscribe`, so a frame loop slower than
 * the reports, or a Mixer tab that is hidden or re-rendered, never misses
 * one.
 *
 * One watch per stage, kept in a `WeakMap`: the master strip's section and
 * the top-bar light read the same latch, and a rebuild's new stage starts a
 * fresh one while the old one goes with its stage.
 */
import type { OutputStage } from '@windsor/engine';
import { type OutputStageAction, reportAction, reportActed } from './outputStageModel';
import { OUTPUT_OFF_CLIP_LEVEL } from './outputStageTables';

/**
 * The slice of a stage the watch reads; a test fakes this much. Not its
 * settings: a report is judged by itself, since it may arrive after a mode
 * switch (`reportActed`).
 */
export type WatchedStage = Pick<OutputStage, 'subscribe'>;

/** The slice the meters' frame loop reads: the watch's, plus the latest report. */
export type MeteredStage = WatchedStage & Pick<OutputStage, 'revision' | 'read'>;

/** One side of the stage's stereo input. */
export type InputChannel = 'left' | 'right';

export interface OutputStageWatch {
  /** Set when the stage acts; cleared only by `resetLatch` (the stage lamp). */
  readonly latched: boolean;
  /**
   * What latched it, from the latching report alone (`reportAction`), so a
   * mode change before the reset keeps the name; `null` while unlatched.
   */
  readonly latchedAction: OutputStageAction | null;
  /** When the stage last acted, in `now()` milliseconds; `null` if it never has. */
  readonly lastActedMs: number | null;
  /** Whether `channel`'s input went above 0 dBFS since it was last cleared. */
  inputOver(channel: InputChannel): boolean;
  /** Clears one input channel's latch, and nothing else. */
  clearInputOver(channel: InputChannel): void;
  /**
   * Clears the stage's latch and its action (the lamp), and nothing else:
   * each input latch has its own clear (record
   * `2026-09-30-master-column-and-meters`, decision 5).
   */
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
  let latchedAction: OutputStageAction | null = null;
  let lastActedMs: number | null = null;
  const over = { left: false, right: false };
  stage.subscribe((report) => {
    if (report.inputLeft > OUTPUT_OFF_CLIP_LEVEL) over.left = true;
    if (report.inputRight > OUTPUT_OFF_CLIP_LEVEL) over.right = true;
    // The latch keeps windsor#94's rule (`reportActed`), and any report it
    // passes has an action; the name is the latching report's own, so a
    // later report never renames it.
    const action = reportActed(report) ? reportAction(report) : null;
    if (action === null) return;
    latchedAction ??= action;
    lastActedMs = now();
  });
  const watch: OutputStageWatch = {
    get latched() {
      return latchedAction !== null;
    },
    get latchedAction() {
      return latchedAction;
    },
    get lastActedMs() {
      return lastActedMs;
    },
    inputOver: (channel) => over[channel],
    clearInputOver: (channel) => {
      over[channel] = false;
    },
    resetLatch: () => {
      latchedAction = null;
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
