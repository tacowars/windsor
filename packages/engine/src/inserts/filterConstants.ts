/**
 * The Filter insert's controls (windsor#622): the voice's own filter, `Svf`
 * and `Ladder` from `worklet/fm/`, run on a strip. The ranges are the
 * voice's (`worklet/fm/voiceTargetTables.ts`, the `filter.cutoff` and
 * `filter.resonance` rows; `filterSpec.test.ts` holds them equal), and the
 * Reso means what a patch's does: `Svf.q` in the SVF modes, the Acid knob's
 * value in `tuneLadder`. Read by the main thread and by
 * `worklet/filter/`, so it imports only the import-free `modeIds.ts`.
 */
import { FILT_BP, FILT_HP, FILT_LADDER, FILT_LP, FILT_NOTCH } from '../worklet/fm/modeIds';

/** The processor's registered name. */
export const FILTER_NAME = 'filter-insert';

/** The modes, in the order of the processor's `mode` param (a mode's index here). */
export const FILTER_MODES = ['lowpass', 'highpass', 'bandpass', 'notch', 'acid'] as const;
export type FilterMode = (typeof FILTER_MODES)[number];

/** Each mode's id in the voice's filter (`modeIds.ts`), index for index with `FILTER_MODES`. */
export const FILTER_MODE_VOICE_IDS: readonly number[] = [
  FILT_LP,
  FILT_HP,
  FILT_BP,
  FILT_NOTCH,
  FILT_LADDER,
];

/** The continuous fields: the processor's automatable params, and the lanes' rows. */
export const FILTER_BOUNDS = {
  cutoff: [30, 18000],
  resonance: [0.5, 12],
  mix: [0, 1],
} as const;

/** Fully open: a new Filter changes nothing until it is turned down. */
export const FILTER_DEFAULTS = {
  cutoff: 18000,
  resonance: 0.707,
  mix: 1,
};

export const FILTER_DSP = {
  /**
   * The frames the DSP holds at once: Web Audio's render quantum. A longer
   * quantum is run in blocks of this many, each gliding as a quantum does.
   */
  blockFrames: 128,
  /** A switch param's value at and above which it reads as on. */
  switchOn: 0.5,
} as const;
