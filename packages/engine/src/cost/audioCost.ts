/**
 * What audio costs this page, in one call (#275): `AudioSystem.costReadout()`,
 * for a load display or a benchmark. (In Aotearoa204 its readers were the
 * game's debug overlay and bench; Windsor's console does not read it yet.)
 *
 * Three measurements of three different things, deliberately not merged into
 * one number:
 *
 *   `load`     what the DSP costs on the **audio** thread, estimated by the
 *              worklets' duty-cycle sampler (#445, `audioLoad.ts`) — the
 *              `est` on screen, over-reading by roughly 2–3×.
 *   `sched`    what the scheduler costs on the **main** thread, timed
 *              directly (#275 decision 7, `schedCost.ts`).
 *   `playback` whether the output actually reached the device, from
 *              `AudioContext.playbackStats` (#275 decision 3,
 *              `playbackStats.ts`) — `null` on a browser without the API,
 *              never a substituted estimate (decision 5).
 *
 * `playback` here is the **context-lifetime totals**, which is what a
 * listener experiences; a benchmark wants deltas over its measured window
 * (decision 6) and takes them from `PlaybackStatsWindow`, not from here.
 */
import type { AudioLoadReadout } from './audioLoad';
import { ZERO_AUDIO_LOAD } from './audioLoad';
import type { PlaybackStatsSnapshot } from './playbackStats';
import type { SchedCostReadout } from './schedCost';
import { ZERO_SCHED_COST } from './schedCost';

export interface AudioCostReadout {
  load: AudioLoadReadout;
  sched: SchedCostReadout;
  /** Context-lifetime playback counters, or `null` where the API is absent. */
  playback: PlaybackStatsSnapshot | null;
}

/** A page with no audio at all: zeros for both costs, and no playback stats to have. */
export const ZERO_AUDIO_COST: AudioCostReadout = {
  load: ZERO_AUDIO_LOAD,
  sched: ZERO_SCHED_COST,
  playback: null,
};
