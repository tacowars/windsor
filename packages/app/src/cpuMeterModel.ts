/**
 * The CPU meter's rules (windsor#13), pure so they test in Node: how a load
 * reading is drawn and labelled, when the meter samples, and whether a new
 * underrun count flashes the meter and toasts. The numbers are the engine's
 * (`AudioSystem.readout().load`); the console only displays them.
 *
 * The sampler's `loadPct` cannot see the browser's own work on the audio
 * thread, so it stops rising near the limit (windsor#794). The audio clock's
 * rate and the device's underruns, where the engine has them, say when the
 * render is losing whatever `loadPct` reads.
 */
import { CLOCK_RATE_LOSING } from '@windsor/engine';
import {
  CPU_METER_FLASH_MS,
  CPU_METER_FULL_PCT,
  CPU_METER_INTERVAL_MS,
  CPU_METER_MAX_LABEL_PCT,
  CPU_METER_SETTLE_MS,
  CPU_METER_TOAST_GAP_MS,
} from './cpuMeterConstants';

/** The slice of `MusicReadout['load']` the meter draws. */
export interface CpuLoad {
  loadPct: number;
  peakPct: number;
  underruns: number;
  /** The audio clock's rate over the last interval; null while unknown. */
  clockRate: number | null;
  /** The output device's cumulative underruns; null where the browser has none to give. */
  deviceUnderruns: number | null;
}

/** What the meter paints for one reading. */
export interface CpuMeterView {
  /** The bar's fill, 0..1 of the meter's width. */
  fill: number;
  /** The peak tick's position, 0..1 of the meter's width. */
  peak: number;
  /** The current load, `NN%`. */
  label: string;
  /** The load is past the whole budget, or the audio clock is behind real time. */
  over: boolean;
  /** The button's title and accessible text. */
  summary: string;
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

/** The audio clock is behind real time: a known rate below the floor. */
export function clockLosing(clockRate: number | null, floor = CLOCK_RATE_LOSING): boolean {
  return clockRate !== null && Number.isFinite(clockRate) && clockRate < floor;
}

/**
 * `CPU 12%, peak 3%, underruns 0`, then `, clock 0.93` while the clock is
 * below the floor and `, device underruns N` where the device count is known.
 */
export function cpuMeterSummary(load: CpuLoad, floor = CLOCK_RATE_LOSING): string {
  const parts = [
    `CPU ${formatLoad(load.loadPct)}`,
    `peak ${Math.round(sanePct(load.peakPct))}%`,
    `underruns ${load.underruns}`,
  ];
  if (clockLosing(load.clockRate, floor)) parts.push(`clock ${load.clockRate?.toFixed(2)}`);
  if (load.deviceUnderruns !== null) parts.push(`device underruns ${load.deviceUnderruns}`);
  return parts.join(', ');
}

/**
 * The bar, the peak tick, the label and the summary for one reading; both
 * marks clamp at a full bar. A clock behind real time draws the full-scale
 * over-budget bar whatever the sampler reads.
 */
export function cpuMeterView(load: CpuLoad, fullPct = CPU_METER_FULL_PCT): CpuMeterView {
  const losing = clockLosing(load.clockRate);
  return {
    fill: losing ? 1 : fraction(load.loadPct, fullPct),
    peak: fraction(load.peakPct, fullPct),
    label: formatLoad(load.loadPct),
    over: losing || sanePct(load.loadPct) > fullPct,
    summary: cpuMeterSummary(load),
  };
}

/**
 * The sample the meter is on at `nowMs`: it changes once per interval, so a
 * `watchPlayhead` over it marks at about 4 Hz and does nothing in between.
 */
export function meterSampleAt(nowMs: number, intervalMs = CPU_METER_INTERVAL_MS): number {
  return Math.floor(nowMs / intervalMs);
}

/** The two cumulative deadline-miss counts a reading carries. */
export type OverrunCounts = Pick<CpuLoad, 'underruns' | 'deviceUnderruns'>;

/** The overrun alert's memory between readings. */
export interface OverrunState {
  /** The sampler's count last seen; null before the first reading. */
  underruns: number | null;
  /** The device's count last seen; null before its first known reading. */
  deviceUnderruns: number | null;
  /** When the last toast went up; null before the first. */
  lastToastMs: number | null;
  /** The meter shows red until this time. */
  flashUntilMs: number;
}

export const INITIAL_OVERRUN_STATE: OverrunState = {
  underruns: null,
  deviceUnderruns: null,
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
  /** How far the sampler's count (the DSP missed a deadline in `process()`) rose since the last reading. */
  dspAdded: number;
  /** How far the output device's count (the output ran dry) rose since the last reading. */
  deviceAdded: number;
}

/**
 * How far one cumulative count rose since its baseline. The first known
 * reading only sets the baseline, and a count that falls adds nothing, so
 * each count re-baselines on its own.
 */
function rise(previous: number | null, count: number | null): number {
  if (previous === null || count === null) return 0;
  return Math.max(0, count - previous);
}

/**
 * One reading of the sampler's and the device's cumulative underrun counts.
 * They are tracked apart: a rebuilt system restarts the sampler's count at 0
 * on the same context, while the device's keeps counting. A rise in either
 * flashes the meter for `flashMs` and toasts unless one went up within
 * `toastGapMs`, once per reading; a steady or falling count does neither.
 * Before `settleUntilMs` (a cold start's window, `stepSettle`) a rise only
 * moves the baseline: it neither flashes nor toasts, and is not carried over.
 */
export function stepOverrun(
  state: OverrunState,
  counts: OverrunCounts,
  nowMs: number,
  settleUntilMs = -Infinity,
  rules: OverrunRules = OVERRUN_RULES,
): OverrunStep {
  const dspAdded = rise(state.underruns, counts.underruns);
  const deviceAdded = rise(state.deviceUnderruns, counts.deviceUnderruns);
  let { lastToastMs, flashUntilMs } = state;
  let toast = false;
  if (dspAdded + deviceAdded > 0 && nowMs >= settleUntilMs) {
    flashUntilMs = nowMs + rules.flashMs;
    toast = lastToastMs === null || nowMs - lastToastMs >= rules.toastGapMs;
    if (toast) lastToastMs = nowMs;
  }
  return {
    state: {
      underruns: counts.underruns,
      deviceUnderruns: counts.deviceUnderruns ?? state.deviceUnderruns,
      lastToastMs,
      flashUntilMs,
    },
    flashing: nowMs < flashUntilMs,
    toast,
    dspAdded,
    deviceAdded,
  };
}

/**
 * The toast's sentence for a step that toasts (windsor#836). A DSP rise means
 * the render itself missed a deadline, so it wins whatever the device did and
 * counts the DSP's rise alone; a device rise on its own means the output ran
 * dry while the DSP kept up.
 */
export function overrunMessage(step: Pick<OverrunStep, 'dspAdded' | 'deviceAdded'>): string {
  if (step.dspAdded > 0) {
    const deadlines = step.dspAdded === 1 ? 'a deadline' : `${step.dspAdded} deadlines`;
    return `audio overrun: the DSP missed ${deadlines} — this song is at the CPU's limit`;
  }
  const times = step.deviceAdded === 1 ? 'once' : `${step.deviceAdded} times`;
  return `audio dropout: the output ran dry ${times} — the audio thread fell behind`;
}

/** What a reading sees of a cold start: which system, and whether ▶ is running. */
export interface SettleFacts {
  /** The system's identity; a different value is a new system. */
  system: unknown;
  /** The transport is running. */
  playing: boolean;
}

/** The cold-start window's memory between readings. */
export interface SettleState {
  /** The system the last reading saw; null before the first. */
  system: unknown;
  /** The transport has started on that system. */
  started: boolean;
  /** Overruns neither flash nor toast before this time. */
  settleUntilMs: number;
}

export const INITIAL_SETTLE_STATE: SettleState = {
  system: null,
  started: false,
  settleUntilMs: -Infinity,
};

/**
 * Open the cold-start window (windsor#835) for `settleMs` when a reading sees
 * a new system (power-on, an import, an undo or redo rebuild, a rebuild while
 * playing) or the transport's first start on that system. A later ▶ on the
 * same system opens nothing. A system that arrives already playing counts as
 * started: its own window covers that first play.
 */
export function stepSettle(
  state: SettleState,
  facts: SettleFacts,
  nowMs: number,
  settleMs = CPU_METER_SETTLE_MS,
): SettleState {
  if (facts.system !== state.system) {
    return { system: facts.system, started: facts.playing, settleUntilMs: nowMs + settleMs };
  }
  if (facts.playing && !state.started) {
    return { system: state.system, started: true, settleUntilMs: nowMs + settleMs };
  }
  return state;
}
