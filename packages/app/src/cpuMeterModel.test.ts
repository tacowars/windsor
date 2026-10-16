import { describe, expect, it } from 'vitest';
import {
  CPU_METER_FLASH_MS,
  CPU_METER_SETTLE_MS,
  CPU_METER_TOAST_GAP_MS,
} from './cpuMeterConstants';
import {
  INITIAL_OVERRUN_STATE,
  INITIAL_SETTLE_STATE,
  type OverrunState,
  type SettleState,
  type CpuLoad,
  cpuMeterView,
  formatLoad,
  meterSampleAt,
  overrunMessage,
  stepOverrun,
  stepSettle,
} from './cpuMeterModel';

/** A reading with no clock or device figure, overridden per case. */
const reading = (over: Partial<CpuLoad> = {}): CpuLoad => ({
  loadPct: 0,
  peakPct: 0,
  underruns: 0,
  clockRate: null,
  deviceUnderruns: null,
  ...over,
});

describe('formatLoad', () => {
  it('rounds to a whole percent', () => {
    expect(formatLoad(0)).toBe('0%');
    expect(formatLoad(12.4)).toBe('12%');
    expect(formatLoad(143.6)).toBe('144%');
  });

  it('reads nonsense as 0 and caps the label', () => {
    expect(formatLoad(Number.NaN)).toBe('0%');
    expect(formatLoad(-5)).toBe('0%');
    expect(formatLoad(Infinity)).toBe('0%');
    expect(formatLoad(999)).toBe('999%');
    expect(formatLoad(1234)).toBe('>999%');
  });
});

describe('cpuMeterView', () => {
  it('draws an idle system as an empty bar at 0%', () => {
    expect(cpuMeterView(reading())).toEqual({
      fill: 0,
      peak: 0,
      label: '0%',
      over: false,
      summary: 'CPU 0%, peak 0%, underruns 0',
    });
  });

  it('places the bar and the peak tick as fractions of the budget', () => {
    const view = cpuMeterView(reading({ loadPct: 25, peakPct: 60 }));
    expect(view.fill).toBeCloseTo(0.25);
    expect(view.peak).toBeCloseTo(0.6);
    expect(view.over).toBe(false);
  });

  it('clamps a load past the budget to a full bar and flags it', () => {
    const view = cpuMeterView(reading({ loadPct: 180, peakPct: 400, underruns: 3 }));
    expect(view).toMatchObject({ fill: 1, peak: 1, label: '180%', over: true });
  });

  it('goes full-scale over while the audio clock is behind, whatever the sampler reads', () => {
    const losing = cpuMeterView(reading({ loadPct: 40, peakPct: 20, clockRate: 0.95 }));
    expect(losing).toMatchObject({ fill: 1, label: '40%', over: true });
    expect(losing.summary).toBe('CPU 40%, peak 20%, underruns 0, clock 0.95');
    const keepingUp = cpuMeterView(reading({ loadPct: 40, peakPct: 20, clockRate: 1.0 }));
    expect(keepingUp).toMatchObject({ fill: 0.4, over: false });
    expect(keepingUp.summary).toBe('CPU 40%, peak 20%, underruns 0');
  });

  it('names the device underruns only when the browser gives a count', () => {
    expect(cpuMeterView(reading({ loadPct: 12, deviceUnderruns: 4 })).summary).toBe(
      'CPU 12%, peak 0%, underruns 0, device underruns 4',
    );
    expect(
      cpuMeterView(reading({ loadPct: 12, deviceUnderruns: 0, clockRate: 0.93 })).summary,
    ).toBe('CPU 12%, peak 0%, underruns 0, clock 0.93, device underruns 0');
    expect(cpuMeterView(reading({ loadPct: 12 })).summary).not.toContain('device');
  });
});

describe('meterSampleAt', () => {
  it('changes once per interval, about 4 Hz', () => {
    expect(meterSampleAt(0)).toBe(0);
    expect(meterSampleAt(249)).toBe(0);
    expect(meterSampleAt(250)).toBe(1);
    expect(meterSampleAt(1000)).toBe(4);
  });
});

/** Feed readings `[count, ms]` through the rule, collecting each step. */
function run(readings: Array<[number, number]>): Array<ReturnType<typeof stepOverrun>> {
  let state: OverrunState = INITIAL_OVERRUN_STATE;
  return readings.map(([count, ms]) => {
    const step = stepOverrun(state, { underruns: count, deviceUnderruns: null }, ms);
    state = step.state;
    return step;
  });
}

describe('stepOverrun', () => {
  it('takes the first reading as the baseline, even a non-zero one', () => {
    const [first] = run([[7, 0]]);
    expect(first).toMatchObject({ toast: false, flashing: false, dspAdded: 0 });
  });

  it('neither flashes nor toasts while the count holds steady', () => {
    const steps = run([
      [2, 0],
      [2, 250],
      [2, 500],
    ]);
    expect(steps.some((s) => s.toast || s.flashing)).toBe(false);
  });

  it('flashes for about a second and toasts when the count rises', () => {
    const steps = run([
      [0, 0],
      [3, 250],
      [3, 250 + CPU_METER_FLASH_MS - 1],
      [3, 250 + CPU_METER_FLASH_MS],
    ]);
    expect(steps[1]).toMatchObject({ toast: true, flashing: true, dspAdded: 3 });
    expect(steps[2]).toMatchObject({ toast: false, flashing: true });
    expect(steps[3]).toMatchObject({ toast: false, flashing: false });
  });

  it('gives a burst one toast per gap, and flashes on every rise', () => {
    const readings: Array<[number, number]> = [[0, 0]];
    for (let i = 1; i <= 24; i++) readings.push([i, i * 250]);
    const steps = run(readings);
    const toastTimes = steps.flatMap((s, i) => (s.toast ? [readings[i]?.[1]] : []));
    expect(toastTimes).toEqual([250, 250 + CPU_METER_TOAST_GAP_MS]);
    expect(steps.slice(1).every((s) => s.flashing)).toBe(true);
  });

  it('re-baselines silently when a rebuilt system restarts the count', () => {
    const steps = run([
      [10, 0],
      [0, 250],
      [1, 500],
    ]);
    expect(steps[1]).toMatchObject({ toast: false, flashing: false, dspAdded: 0 });
    expect(steps[2]).toMatchObject({ toast: true, dspAdded: 1 });
  });
});

describe('stepOverrun with the device count', () => {
  it('fires once on a rise in the device count', () => {
    const first = stepOverrun(INITIAL_OVERRUN_STATE, reading({ deviceUnderruns: 2 }), 0);
    const rise = stepOverrun(first.state, reading({ deviceUnderruns: 3 }), 100);
    const steady = stepOverrun(rise.state, reading({ deviceUnderruns: 3 }), 200);
    expect([first.toast, rise.toast, steady.toast]).toEqual([false, true, false]);
    expect(rise.deviceAdded).toBe(1);
  });

  it('still toasts a device rise when a rebuilt system restarts the sampler', () => {
    const first = stepOverrun(
      INITIAL_OVERRUN_STATE,
      reading({ underruns: 10, deviceUnderruns: 100 }),
      0,
    );
    const rebuild = stepOverrun(first.state, reading({ underruns: 0, deviceUnderruns: 105 }), 250);
    expect(rebuild).toMatchObject({ toast: true, flashing: true, deviceAdded: 5 });
  });
});

/** One meter reading as `cpuMeter.ts` takes it: the system, ▶, the count, the time. */
interface ColdReading {
  system: object;
  playing: boolean;
  count: number;
  ms: number;
}

/** Feed readings through the settling window and the overrun rule, as the meter does. */
function runCold(readings: ColdReading[]): Array<ReturnType<typeof stepOverrun>> {
  let overrun: OverrunState = INITIAL_OVERRUN_STATE;
  let settle: SettleState = INITIAL_SETTLE_STATE;
  return readings.map(({ system, playing, count, ms }) => {
    settle = stepSettle(settle, { system, playing }, ms);
    const counts = { underruns: 0, deviceUnderruns: count };
    const step = stepOverrun(overrun, counts, ms, settle.settleUntilMs);
    overrun = step.state;
    return step;
  });
}

const SETTLE = CPU_METER_SETTLE_MS;

describe('the cold-start settling window', () => {
  it('holds a rise after a new system silent, while the baseline moves', () => {
    const sys = {};
    const steps = runCold([
      { system: sys, playing: false, count: 10, ms: 0 },
      { system: sys, playing: false, count: 15, ms: 1200 },
      { system: sys, playing: false, count: 15, ms: SETTLE + 100 },
    ]);
    expect(steps[0]).toMatchObject({ toast: false, flashing: false, deviceAdded: 0 });
    expect(steps[1]).toMatchObject({ toast: false, flashing: false, deviceAdded: 5 });
    expect(steps[1]?.state.deviceUnderruns).toBe(15);
    expect(steps[2]).toMatchObject({ toast: false, flashing: false, deviceAdded: 0 });
  });

  it('holds a rise after the first start on a system, but not after a second', () => {
    const sys = {};
    const start = SETTLE + 10_000;
    const second = start + 20_000;
    const steps = runCold([
      { system: sys, playing: false, count: 0, ms: 0 },
      { system: sys, playing: true, count: 0, ms: start },
      { system: sys, playing: true, count: 4, ms: start + 500 },
      { system: sys, playing: false, count: 4, ms: second - 1000 },
      { system: sys, playing: true, count: 4, ms: second },
      { system: sys, playing: true, count: 6, ms: second + 500 },
    ]);
    expect(steps[2]).toMatchObject({ toast: false, flashing: false, deviceAdded: 4 });
    expect(steps[5]).toMatchObject({ toast: true, flashing: true, deviceAdded: 2 });
  });

  it('opens a fresh window on a new system mid-session, and another on its first start', () => {
    const [a, b, c] = [{}, {}, {}];
    const t = 60_000;
    const steps = runCold([
      { system: a, playing: true, count: 0, ms: 0 },
      { system: b, playing: false, count: 0, ms: t },
      { system: b, playing: false, count: 3, ms: t + 500 },
      { system: b, playing: true, count: 3, ms: t + 10_000 },
      { system: b, playing: true, count: 5, ms: t + 10_500 },
      // A rebuild while playing: a new system that arrives already running.
      { system: c, playing: true, count: 5, ms: t + 30_000 },
      { system: c, playing: true, count: 8, ms: t + 30_500 },
      { system: c, playing: true, count: 9, ms: t + 30_000 + SETTLE + 1 },
    ]);
    expect(steps.slice(0, 7).some((s) => s.toast || s.flashing)).toBe(false);
    expect(steps[7]).toMatchObject({ toast: true, flashing: true, deviceAdded: 1 });
  });

  it('toasts a rise at settle + 1 ms and holds one at settle - 1 ms', () => {
    const riseAt = (ms: number): ReturnType<typeof stepOverrun> | undefined => {
      const sys = {};
      return runCold([
        { system: sys, playing: false, count: 0, ms: 0 },
        { system: sys, playing: false, count: 1, ms },
      ])[1];
    };
    expect(riseAt(SETTLE - 1)).toMatchObject({ toast: false, flashing: false });
    expect(riseAt(SETTLE + 1)).toMatchObject({ toast: true, flashing: true });
  });

  it('toasts a sustained overload on its first reading after the window', () => {
    const sys = {};
    const readings: ColdReading[] = [];
    for (let i = 0; i <= 16; i++) {
      readings.push({ system: sys, playing: false, count: i, ms: i * 250 });
    }
    const steps = runCold(readings);
    const firstToast = steps.findIndex((s) => s.toast);
    expect(readings[firstToast]?.ms).toBe(SETTLE);
    expect(steps.slice(0, firstToast).some((s) => s.flashing)).toBe(false);
    expect(steps[firstToast]?.deviceAdded).toBe(1);
  });

  it('keeps the first-reading baseline and adds nothing for a falling count', () => {
    const sys = {};
    const steps = runCold([
      { system: sys, playing: false, count: 40, ms: 0 },
      { system: sys, playing: false, count: 2, ms: SETTLE + 500 },
    ]);
    expect(steps[0]).toMatchObject({ toast: false, deviceAdded: 0 });
    expect(steps[1]).toMatchObject({ toast: false, flashing: false, deviceAdded: 0 });
  });
});

describe('overrunMessage', () => {
  const dsp = (n: string): string =>
    `audio overrun: the DSP missed ${n} — this song is at the CPU's limit`;
  const dropout = (n: string): string =>
    `audio dropout: the output ran dry ${n} — the audio thread fell behind`;

  it('names the DSP whenever its count rose, counting its rise alone', () => {
    expect(overrunMessage({ dspAdded: 1, deviceAdded: 0 })).toBe(dsp('a deadline'));
    expect(overrunMessage({ dspAdded: 3, deviceAdded: 5 })).toBe(dsp('3 deadlines'));
  });

  it('names an output dropout when only the device count rose', () => {
    expect(overrunMessage({ dspAdded: 0, deviceAdded: 1 })).toBe(dropout('once'));
    expect(overrunMessage({ dspAdded: 0, deviceAdded: 4 })).toBe(dropout('4 times'));
  });

  it('only ever gives the DSP sentence where the device count is unknown', () => {
    const steps = run([
      [0, 0],
      [1, 250],
      [4, 250 + CPU_METER_TOAST_GAP_MS],
    ]);
    const messages = steps.filter((s) => s.toast).map(overrunMessage);
    expect(messages).toEqual([dsp('a deadline'), dsp('3 deadlines')]);
  });
});
