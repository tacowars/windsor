/**
 * The output stage (windsor#93): the last thing before the destination, in
 * one of four modes. `limiter` is `outputStageLimiter.ts`, `soft` and `hard`
 * are `outputStageClipper.ts`, and `off` passes the input through. In every
 * mode the stage measures its input and output peaks for the telemetry
 * report (decision 10), and in every mode but `off` the output never exceeds
 * the ceiling, while a signal under it passes at unity.
 *
 * A change of mode or of the lookahead starts the new path from silence (a
 * click is accepted, decision 4); a change of ceiling takes effect at once.
 * The worklet (`worklet/outputStage/`) calls `configure` once a block from
 * its parameters and `process` once a block; neither allocates.
 * `outputStageDsp.test.ts` pins the behaviour, `outputStageGolden.test.ts`
 * the render.
 */
import {
  DB_PER_DECADE,
  DECADE,
  OUTPUT_LIMITER,
  OUTPUT_OVERSAMPLE,
  OUTPUT_SOFT_CLIP,
  OUTPUT_STAGE_MODES,
} from './outputStageConstants';
import type { OutputStageMode, OutputStageReport } from './outputStageConstants';
import type { ClipperActivity, ClipperChannel } from './outputStageClipper';
import { OversampledClipper } from './outputStageClipper';
import type { LimiterActivity } from './outputStageLimiter';
import { OutputLimiter, lookaheadFrames } from './outputStageLimiter';

const LIMITER = OUTPUT_STAGE_MODES.indexOf('limiter');
const SOFT = OUTPUT_STAGE_MODES.indexOf('soft');
const HARD = OUTPUT_STAGE_MODES.indexOf('hard');
const OFF = OUTPUT_STAGE_MODES.indexOf('off');

export const dbToGain = (db: number): number => Math.pow(DECADE, db / DB_PER_DECADE);
export const gainToDb = (gain: number): number => DB_PER_DECADE * Math.log10(gain);

/** The tables the stage is built from; the shipped ones by default. */
export interface OutputStageTables {
  limiter: typeof OUTPUT_LIMITER;
  soft: typeof OUTPUT_SOFT_CLIP;
  oversample: typeof OUTPUT_OVERSAMPLE;
}
export const OUTPUT_STAGE_TABLES: OutputStageTables = {
  limiter: OUTPUT_LIMITER,
  soft: OUTPUT_SOFT_CLIP,
  oversample: OUTPUT_OVERSAMPLE,
};

/**
 * The frames the stage delays its output by with these settings (decision
 * 9): 0 for `off` and for the limiter without lookahead, the lookahead with
 * it, and the oversampling filters' delay for the clippers. The offline
 * render drops this many frames from the head of the master.
 */
export function outputStageLatency(
  settings: { mode: OutputStageMode; lookahead: boolean },
  sampleRate: number,
  tables: OutputStageTables = OUTPUT_STAGE_TABLES,
): number {
  if (settings.mode === 'off') return 0;
  if (settings.mode === 'limiter') {
    return settings.lookahead ? lookaheadFrames(tables.limiter, sampleRate) : 0;
  }
  return (tables.oversample.taps - 1) / 2;
}

export class OutputStageDsp {
  private readonly limiter: OutputLimiter;
  private readonly clipper: OversampledClipper;
  private readonly left: ClipperChannel;
  private readonly right: ClipperChannel;
  private readonly kneeGain: number = 0;
  private readonly limited: LimiterActivity = { minGain: 1, overshoot: 1 };
  private readonly clipped: ClipperActivity = { acted: false };
  private mode = -1;
  private ceilingDb = Number.NaN;
  private ceiling = 1;
  private inL = 0;
  private inR = 0;
  private outL = 0;
  private outR = 0;

  constructor(sampleRate: number, tables: OutputStageTables = OUTPUT_STAGE_TABLES) {
    this.limiter = new OutputLimiter(sampleRate, tables.limiter);
    this.clipper = new OversampledClipper(tables.oversample);
    this.left = this.clipper.channel();
    this.right = this.clipper.channel();
    this.kneeGain = dbToGain(-tables.soft.kneeDb);
  }

  /** The frames the output lags the input by, as configured now. */
  get latency(): number {
    if (this.mode === LIMITER) return this.limiter.latency;
    if (this.mode === SOFT || this.mode === HARD) return this.clipper.latency;
    return 0;
  }

  /**
   * The settings, from the processor's parameters: `mode` an index into
   * `OUTPUT_STAGE_MODES`. Cheap when nothing changed, so it runs every block.
   */
  configure(mode: number, ceilingDb: number, lookahead: boolean): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.limiter.reset();
      this.clipper.reset(this.left);
      this.clipper.reset(this.right);
    }
    this.limiter.setLookahead(lookahead);
    if (ceilingDb !== this.ceilingDb) {
      this.ceilingDb = ceilingDb;
      // Rounded to a float, so the clamp's bound is exactly a sample value.
      this.ceiling = Math.fround(dbToGain(ceilingDb));
      this.limiter.setCeiling(this.ceiling);
    }
    this.clipper.configure(mode === SOFT, this.ceiling, this.ceiling * this.kneeGain);
  }

  process(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    frames: number,
  ): void {
    this.inL = peak(inL, frames, this.inL);
    this.inR = peak(inR, frames, this.inR);
    if (this.mode === LIMITER) {
      this.limiter.process(inL, inR, outL, outR, frames, this.limited);
    } else if (this.mode === SOFT || this.mode === HARD) {
      this.clipper.process(this.left, inL, outL, frames, this.clipped);
      this.clipper.process(this.right, inR, outR, frames, this.clipped);
    } else {
      for (let i = 0; i < frames; i++) {
        outL[i] = inL[i]!;
        outR[i] = inR[i]!;
      }
    }
    this.outL = peak(outL, frames, this.outL);
    this.outR = peak(outR, frames, this.outR);
  }

  /** Fill `report` with what happened since the last call, and start the next interval. */
  takeReport(report: OutputStageReport): void {
    report.inputLeft = this.inL;
    report.inputRight = this.inR;
    report.outputLeft = this.outL;
    report.outputRight = this.outR;
    const limiting = this.mode === LIMITER;
    const clipping = this.mode === SOFT || this.mode === HARD;
    const minGain = this.limited.minGain;
    report.reductionDb = limiting && minGain < 1 ? -gainToDb(minGain) : 0;
    const loudest = Math.max(this.inL, this.inR);
    report.overDb = clipping && loudest > this.ceiling ? gainToDb(loudest / this.ceiling) : 0;
    report.active =
      this.mode !== OFF &&
      ((limiting && (minGain < 1 || this.limited.overshoot > 1)) ||
        (clipping && this.clipped.acted));
    this.inL = this.inR = this.outL = this.outR = 0;
    this.limited.minGain = 1;
    this.limited.overshoot = 1;
    this.clipped.acted = false;
  }
}

function peak(samples: Float32Array, frames: number, from: number): number {
  let p = from;
  for (let i = 0; i < frames; i++) {
    const a = Math.abs(samples[i]!);
    if (a > p) p = a;
  }
  return p;
}
