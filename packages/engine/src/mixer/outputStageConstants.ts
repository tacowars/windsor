/**
 * The output stage's tables (windsor#93): the modes, the ceiling's range, the
 * limiter's times, the soft clip's knee, the oversampling filter, and the
 * telemetry report's shape. The worklet (`worklet/outputStage/`) and the
 * main thread both read this file, so it imports nothing that touches the
 * DOM or the worklet scope.
 */
import { PEAK_METER } from './peakMeterConstants';

/** The processor's registered name. */
export const OUTPUT_STAGE_NAME = 'windsor-output-stage';

/** The modes, in the order of the processor's `mode` parameter (its index). */
export const OUTPUT_STAGE_MODES = ['limiter', 'soft', 'hard', 'off'] as const;
export type OutputStageMode = (typeof OUTPUT_STAGE_MODES)[number];

/** The ceiling in dBFS: its range and the default a new song starts on. */
export const OUTPUT_CEILING_DB = { min: -12, max: 0, default: -1 } as const;

/** What a song with no `master.output` plays through (decisions 2, 3 and 4). */
export const OUTPUT_STAGE_DEFAULTS = {
  mode: 'limiter',
  ceilingDb: OUTPUT_CEILING_DB.default,
  lookahead: false,
} as const satisfies { mode: OutputStageMode; ceilingDb: number; lookahead: boolean };

/**
 * The limiter (decision 4). Without lookahead the gain falls towards what the
 * loudest sample needs with a one-pole attack of `attackMs`, and the final
 * clip at the ceiling catches what the attack lets through. With lookahead
 * the attack is a straight ramp across `lookaheadMs`, which reaches the
 * needed gain by the time the peak arrives. Either way the gain recovers with
 * a one-pole release of `releaseMs`, and snaps back to exactly 1 once it is
 * within `unityEpsilon` of it, so a quiet passage after a loud one is again
 * passed untouched.
 */
export const OUTPUT_LIMITER = {
  attackMs: 0.1,
  releaseMs: 80,
  lookaheadMs: 1.5,
  unityEpsilon: 1e-6,
} as const;

/**
 * The soft clip (decision 5): identity up to `kneeDb` below the ceiling, then
 * a rational curve that leaves the knee at slope 1 and approaches the ceiling
 * without reaching it.
 */
export const OUTPUT_SOFT_CLIP = { kneeDb: 6 } as const;

/**
 * The clippers' 2× oversampling (decision 7): one linear-phase half-band FIR,
 * a windowed sinc of `taps` taps, used to upsample and again to decimate. The
 * tap count is 4k + 3, so the centre tap is odd and each filter delays by
 * (taps − 1) / 2 samples at the doubled rate: the two together delay by
 * (taps − 1) / 2 frames at the song's rate, which the stage reports as its
 * latency. The window is Blackman's, `blackman` its three weights.
 */
export const OUTPUT_OVERSAMPLE = {
  factor: 2,
  taps: 31,
  blackman: [0.42, 0.5, 0.08],
} as const;

/** How often the processor posts its report: the peak meter's rate. */
export const OUTPUT_STAGE_REPORT_HZ = PEAK_METER.reportHz;

/** Milliseconds in a second, for the limiter's times. */
export const MS_PER_SECOND = 1000;

/** dB per decade of amplitude, and the decade. */
export const DB_PER_DECADE = 20;
export const DECADE = 10;

/**
 * One report (decision 10), posted at `OUTPUT_STAGE_REPORT_HZ` whenever the
 * context runs. Every field covers the frames since the last report.
 */
export interface OutputStageReport {
  type: 'outputStage';
  /** Sample peaks of the stage's input and output, linear. */
  inputLeft: number;
  inputRight: number;
  outputLeft: number;
  outputRight: number;
  /** The limiter's deepest gain reduction, in dB (0 or more; 0 in the other modes). */
  reductionDb: number;
  /** How far the input's peak went past the ceiling, in dB (0 or more; the clippers only). */
  overDb: number;
  /** Whether the stage changed any sample. */
  active: boolean;
}

/** A report of silence: what a stage reads before its first post. */
export function silentReport(): OutputStageReport {
  return {
    type: 'outputStage',
    inputLeft: 0,
    inputRight: 0,
    outputLeft: 0,
    outputRight: 0,
    reductionDb: 0,
    overDb: 0,
    active: false,
  };
}
