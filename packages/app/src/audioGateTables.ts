/**
 * The audio gate's words (windsor#578), word for word from the approved
 * mockup, `docs/design/audio-gate-mockup.html`. The rules are
 * `audioGateModel.ts`; the build line's format is `audioGateBuildLine.ts`.
 */

/** What the gate says in one state: the line under the button and the lede beneath it. */
export interface GateCopy {
  readonly action: string;
  /** `{error}` marks where the failed state's error text goes, set as code. */
  readonly lede: string;
}

/** The gate's copy per open state. */
export interface GateCopyTable {
  readonly first: GateCopy;
  readonly starting: GateCopy;
  readonly failed: GateCopy;
  readonly back: GateCopy;
}

export const GATE_COPY: GateCopyTable = {
  first: {
    action: 'Enable audio',
    lede: 'Browsers keep a page silent until you ask for sound. Windsor starts its audio engine when you press this.',
  },
  starting: {
    action: 'Starting…',
    lede: 'Loading the synth and effects into the audio thread.',
  },
  failed: {
    action: 'Audio didn’t start',
    lede: 'The audio engine failed to load ({error}). Press to try again.',
  },
  back: {
    action: 'Resume audio',
    lede: 'Your browser paused Windsor’s audio while you were away. Press to pick up where you left off.',
  },
};

/** Where the error text sits in a lede. */
export const GATE_ERROR_SLOT = '{error}';

/** The build line's months, as the mockup writes a date: `4 Oct 2026`. */
export const BUILD_MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
