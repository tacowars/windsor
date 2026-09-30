/**
 * The output stage's display rules (windsor#94): what an edit writes into
 * `master.output`, which gauge each mode shows, the meters' scales, when the
 * clip light latches, how a readout holds its peak, and the top-bar light.
 * Values in, values out; `outputStageSection.ts`, `outputStageMeters.ts` and
 * `outputStageLight.ts` only draw what this returns.
 */
import { masterOutput } from '@windsor/engine';
import type {
  MasterSpec,
  OutputStageMode,
  OutputStageReport,
  OutputStageSettings,
} from '@windsor/engine';
import { amplitudeDb } from './masterTables';
import {
  OUTPUT_GAUGE_MAX_DB,
  OUTPUT_LIGHT_HOLD_MS,
  OUTPUT_MODE_LABELS,
  OUTPUT_OFF_CLIP_LEVEL,
  OUTPUT_PEAK_SCALE,
} from './outputStageTables';

/**
 * The live partial for an edit: the whole `output` with `edit` over the
 * settings in force, so a mode change keeps the ceiling and the lookahead.
 */
export function outputEdit(
  master: MasterSpec | undefined,
  edit: Partial<OutputStageSettings>,
): { master: { output: OutputStageSettings } } {
  return { master: { output: { ...masterOutput(master), ...edit } } };
}

/** The Lookahead toggle is live in Limiter mode only; elsewhere it keeps its value. */
export const lookaheadEnabled = (mode: OutputStageMode): boolean => mode === 'limiter';

/** The gauge beside the peaks: gain reduction, the excess over the ceiling, or none in Off. */
export type OutputGauge = 'reduction' | 'over' | 'none';
export function gaugeFor(mode: OutputStageMode): OutputGauge {
  if (mode === 'limiter') return 'reduction';
  return mode === 'off' ? 'none' : 'over';
}

/** A linear sample peak on the peak bars' dBFS scale, clamped to its ends. */
export function peakDb(linear: number, scale = OUTPUT_PEAK_SCALE): number {
  const db = amplitudeDb(linear);
  return Math.min(scale.ceilingDb, Math.max(scale.floorDb, db));
}

/** A reduction or over reading on the gauge, clamped to 0 .. `max`. */
export function gaugeDb(db: number, max = OUTPUT_GAUGE_MAX_DB): number {
  return Number.isFinite(db) ? Math.min(max, Math.max(0, db)) : 0;
}

/**
 * Whether the stage acted in a report's interval: it changed a sample, or, in
 * Off mode where it never does, a sample went above 0 dBFS (decision 3).
 *
 * Judged from the report alone, never from the mode in force now: a report
 * reaches the console after a mode switch the stage applied at once, so the
 * current mode need not be the one that made it. `active` was computed on
 * the audio thread by the modes that ran in the interval, and every mode but
 * Off holds the output at a ceiling of 0 dBFS or below, so an output peak
 * above 0 dBFS can only come from Off.
 */
export function reportActed(report: Readonly<OutputStageReport>): boolean {
  if (report.active) return true;
  return Math.max(report.outputLeft, report.outputRight) > OUTPUT_OFF_CLIP_LEVEL;
}

/** What latched the stage lamp (record `2026-09-30-master-column-and-meters`, decision 6). */
export type OutputStageAction = 'Limiting' | 'Clipping' | 'Over 0 dB';

/**
 * The action a report shows, or `null` where the stage did not act
 * (windsor#193 decision 5). Like `reportActed`, judged from the report alone:
 * a reduction is the limiter's, a changed sample otherwise a clipper's, and
 * an output above 0 dBFS with neither can only come from Off.
 */
export function reportAction(report: Readonly<OutputStageReport>): OutputStageAction | null {
  if (report.reductionDb > 0) return 'Limiting';
  if (report.active) return 'Clipping';
  if (Math.max(report.outputLeft, report.outputRight) > OUTPUT_OFF_CLIP_LEVEL) return 'Over 0 dB';
  return null;
}

/** What the meters draw: four peaks (in L, in R, out L, out R) in dBFS and the gauge. */
export interface OutputMeterView {
  readonly peaks: readonly [number, number, number, number];
  readonly gauge: OutputGauge;
  readonly gaugeDb: number;
}

/** A report's four linear sample peaks, in the meters' order. */
export function reportPeaks(
  report: Readonly<OutputStageReport>,
): readonly [number, number, number, number] {
  return [report.inputLeft, report.inputRight, report.outputLeft, report.outputRight];
}

/** The meters for a report, or idle (the floor and an empty gauge) for none. */
export function meterView(
  report: Readonly<OutputStageReport> | null,
  mode: OutputStageMode,
): OutputMeterView {
  const gauge = gaugeFor(mode);
  if (!report) {
    const floor = OUTPUT_PEAK_SCALE.floorDb;
    return { peaks: [floor, floor, floor, floor], gauge, gaugeDb: 0 };
  }
  const reading = gauge === 'reduction' ? report.reductionDb : report.overDb;
  const [inL, inR, outL, outR] = reportPeaks(report);
  return {
    peaks: [peakDb(inL), peakDb(inR), peakDb(outL), peakDb(outR)],
    gauge,
    gaugeDb: gauge === 'none' ? 0 : gaugeDb(reading),
  };
}

/** A readout's held peak: the highest value, and when it was reached. */
export interface HeldPeak {
  readonly value: number;
  readonly atMs: number;
}
export const EMPTY_HOLD: HeldPeak = { value: 0, atMs: -Infinity };

/** Keep the higher value for `holdMs`, then follow the reading again. */
export function stepHold(hold: HeldPeak, value: number, nowMs: number, holdMs: number): HeldPeak {
  if (value >= hold.value || nowMs - hold.atMs >= holdMs) return { value, atMs: nowMs };
  return hold;
}

/** A peak readout: `−∞` at silence, else dBFS to a tenth. */
export function peakLabel(linear: number): string {
  return linear > 0 ? `${amplitudeDb(linear).toFixed(1)} dBFS` : '−∞ dBFS';
}

/** The top-bar light (decision 4): lit, unlit, or outlined in Off mode. */
export type OutputLightState = 'lit' | 'unlit' | 'off';
export interface OutputLightView {
  readonly state: OutputLightState;
  readonly title: string;
}

/** The light for `mode`, given when the stage last acted (`null`: never). */
export function outputLight(
  mode: OutputStageMode,
  lastActedMs: number | null,
  nowMs: number,
  holdMs = OUTPUT_LIGHT_HOLD_MS,
): OutputLightView {
  const title = `Output: ${OUTPUT_MODE_LABELS[mode]}`;
  if (mode === 'off') return { state: 'off', title };
  const lit = lastActedMs !== null && nowMs - lastActedMs < holdMs;
  return { state: lit ? 'lit' : 'unlit', title };
}
