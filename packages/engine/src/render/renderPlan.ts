/**
 * A song render's frame plan (windsor#40): how long the lead-in, the song and
 * the tail are, and where the render stops next. Pure, so the lengths the
 * acceptance criteria name are tested without an audio context.
 *
 * Stops land on the render quantum, the grid `OfflineAudioContext.suspend`
 * uses, and the song's end is its own stop, rounded up to that grid, so the
 * release lands at or just after the last bar and never before it.
 *
 * The output stage may delay the master (windsor#93 decision 9): the render
 * runs `latencyFrames` longer, and the master is read that many frames later
 * than the stems (`masterStart` against `leadFrames`), so both start on bar 1
 * and run the song and its tail.
 */
import { RENDER_QUANTUM_FRAMES } from './renderConstants';

export interface RenderPlanInput {
  sampleRate: number;
  /** Rendered before tick 0 and trimmed off (the scheduler's start delay). */
  leadSeconds: number;
  songSeconds: number;
  tailSeconds: number;
  /** Frames the output stage delays the master by; 0 when absent. */
  latencyFrames?: number;
}

export interface RenderPlan {
  leadFrames: number;
  songFrames: number;
  tailFrames: number;
  /** Frames the output stage delays the master by (decision 9). */
  latencyFrames: number;
  /** Where the master's bar 1 is in the render: past the lead-in and the stage's latency. */
  masterStart: number;
  /** Frames every file holds: the song and its tail. */
  outputFrames: number;
  totalFrames: number;
  totalSeconds: number;
  /** Context time of the song's last bar line: no tick is issued at or after it. */
  endSeconds: number;
  /** The context time of the stop after `now`, at most `step` later; null when none is left. */
  nextStop(now: number, step: number): number | null;
}

export function planRender(input: RenderPlanInput): RenderPlan {
  const { sampleRate } = input;
  const leadFrames = Math.round(input.leadSeconds * sampleRate);
  const songFrames = Math.round(input.songSeconds * sampleRate);
  const tailFrames = Math.round(input.tailSeconds * sampleRate);
  const latencyFrames = input.latencyFrames ?? 0;
  const totalFrames = leadFrames + songFrames + tailFrames + latencyFrames;
  const endSeconds = input.leadSeconds + input.songSeconds;
  const quantumUp = (frame: number): number =>
    Math.ceil(frame / RENDER_QUANTUM_FRAMES) * RENDER_QUANTUM_FRAMES;
  const endStop = quantumUp(endSeconds * sampleRate);
  return {
    leadFrames,
    songFrames,
    tailFrames,
    latencyFrames,
    masterStart: leadFrames + latencyFrames,
    outputFrames: songFrames + tailFrames,
    totalFrames,
    totalSeconds: totalFrames / sampleRate,
    endSeconds,
    nextStop(now, step) {
      const nowFrame = Math.round(now * sampleRate);
      let frame = quantumUp(nowFrame + step * sampleRate);
      if (frame <= nowFrame) frame = nowFrame + RENDER_QUANTUM_FRAMES;
      if (endStop > nowFrame && endStop < frame) frame = endStop;
      return frame < totalFrames ? frame / sampleRate : null;
    },
  };
}
