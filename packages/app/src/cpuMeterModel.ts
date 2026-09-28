/**
 * The CPU meter's rules (windsor#13), pure so they test in Node: how a load
 * reading is drawn and labelled, when the meter samples, and whether a new
 * underrun count flashes the meter and toasts. The numbers are the engine's
 * (`AudioSystem.readout().load`); the console only displays them.
 */
import {
  CPU_METER_FLASH_MS,
  CPU_METER_FULL_PCT,
  CPU_METER_INTERVAL_MS,
  CPU_METER_MAX_LABEL_PCT,
  CPU_METER_TOAST_GAP_MS,
} from './cpuMeterConstants';

/** The slice of `MusicReadout['load']` the meter draws. */
export interface CpuLoad {
  loadPct: number;
  peakPct: number;
  underruns: number;
}

/** What the meter paints for one reading. */
export interface CpuMeterView {
  /** The bar's fill, 0..1 of the meter's width. */
  fill: number;
  /** The peak tick's position, 0..1 of the meter's width. */
  peak: number;
  /** The current load, `NN%`. */
  label: string;
  /** The load is past the whole budget. */
  over: boolean;
}

/** A reading the engine could not have meant (NaN, negative) is 0. */
function sanePct(pct: number): number {
  return Number.isFinite(pct) && pct > 0 ? pct : 0;
}

function fraction(pct: number, fullPct: number): number {
  return Math.min(1, sanePct(pct) / fullPct);
}

/** `12%`, `0%`, `143%`, and `>999%` past the label's room. */
export function formatLoad(pct: number, maxPct = CPU_METER_MAX_LABEL_PCT): string {
  const rounded = Math.round(sanePct(pct));
  return rounded > maxPct ? `>${maxPct}%` : `${rounded}%`;
}

/** The bar, the peak tick and the label for one reading; both marks clamp at a full bar. */
export function cpuMeterView(load: CpuLoad, fullPct = CPU_METER_FULL_PCT): CpuMeterView {
  return {
    fill: fraction(load.loadPct, fullPct),
    peak: fraction(load.peakPct, fullPct),
    label: formatLoad(load.loadPct),
    over: sanePct(load.loadPct) > fullPct,
  };
}

/**
 * The sample the meter is on at `nowMs`: it changes once per interval, so a
 * `watchPlayhead` over it marks at about 4 Hz and does nothing in between.
 */
export function meterSampleAt(nowMs: number, intervalMs = CPU_METER_INTERVAL_MS): number {
  return Math.floor(nowMs / intervalMs);
}

/** The overrun alert's memory between readings. */
export interface OverrunState {
  /** The count last seen; null before the first reading. */
  underruns: number | null;
  /** When the last toast went up; null before the first. */
  lastToastMs: number | null;
  /** The meter shows red until this time. */
  flashUntilMs: number;
}

export const INITIAL_OVERRUN_STATE: OverrunState = {
  underruns: null,
  lastToastMs: null,
  flashUntilMs: -Infinity,
};

export interface OverrunRules {
  flashMs: number;
  toastGapMs: number;
}

export const OVERRUN_RULES: OverrunRules = {
  flashMs: CPU_METER_FLASH_MS,
  toastGapMs: CPU_METER_TOAST_GAP_MS,
};

export interface OverrunStep {
  state: OverrunState;
  /** The meter is red at this reading. */
  flashing: boolean;
  /** Put up a toast now. */
  toast: boolean;
  /** How many underruns arrived since the last reading. */
  added: number;
}

/**
 * One reading of the cumulative underrun count. A rise flashes the meter for
 * `flashMs` and toasts unless one went up within `toastGapMs`; a steady count
 * does neither. The first reading only sets the baseline, and a count that
 * falls (a rebuilt system starts a new meter at 0) re-baselines silently.
 */
export function stepOverrun(
  state: OverrunState,
  underruns: number,
  nowMs: number,
  rules: OverrunRules = OVERRUN_RULES,
): OverrunStep {
  const previous = state.underruns;
  const added = previous === null ? 0 : Math.max(0, underruns - previous);
  let { lastToastMs, flashUntilMs } = state;
  let toast = false;
  if (added > 0) {
    flashUntilMs = nowMs + rules.flashMs;
    toast = lastToastMs === null || nowMs - lastToastMs >= rules.toastGapMs;
    if (toast) lastToastMs = nowMs;
  }
  return {
    state: { underruns, lastToastMs, flashUntilMs },
    flashing: nowMs < flashUntilMs,
    toast,
    added,
  };
}
