import { describe, expect, it } from 'vitest';
import { CPU_METER_FLASH_MS, CPU_METER_TOAST_GAP_MS } from './cpuMeterConstants';
import {
  INITIAL_OVERRUN_STATE,
  type OverrunState,
  type CpuLoad,
  cpuMeterView,
  formatLoad,
  meterSampleAt,
  overrunCount,
  stepOverrun,
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
    const step = stepOverrun(state, count, ms);
    state = step.state;
    return step;
  });
}

describe('stepOverrun', () => {
  it('takes the first reading as the baseline, even a non-zero one', () => {
    const [first] = run([[7, 0]]);
    expect(first).toMatchObject({ toast: false, flashing: false, added: 0 });
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
    expect(steps[1]).toMatchObject({ toast: true, flashing: true, added: 3 });
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
    expect(steps[1]).toMatchObject({ toast: false, flashing: false, added: 0 });
    expect(steps[2]).toMatchObject({ toast: true, added: 1 });
  });
});

describe('overrunCount', () => {
  it('fires the overrun step once on a rise in the device count', () => {
    const first = stepOverrun(
      INITIAL_OVERRUN_STATE,
      overrunCount(reading({ deviceUnderruns: 2 })),
      0,
    );
    const rise = stepOverrun(first.state, overrunCount(reading({ deviceUnderruns: 3 })), 100);
    const steady = stepOverrun(rise.state, overrunCount(reading({ deviceUnderruns: 3 })), 200);
    expect([first.toast, rise.toast, steady.toast]).toEqual([false, true, false]);
    expect(rise.added).toBe(1);
  });

  it('counts the sampler alone where the device has no figure', () => {
    expect(overrunCount(reading({ underruns: 5 }))).toBe(5);
    expect(overrunCount(reading({ underruns: 5, deviceUnderruns: 2 }))).toBe(7);
  });
});
