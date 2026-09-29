import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_STAGE } from '@windsor/engine';
import type { OutputStageReport, OutputStageSettings } from '@windsor/engine';
import { type WatchedStage, watchOutputStage } from './outputStageWatch';

function fakeStage(settings: OutputStageSettings = DEFAULT_OUTPUT_STAGE): WatchedStage & {
  post(over: Partial<OutputStageReport>): void;
  settings: OutputStageSettings;
  listeners: number;
} {
  const listeners = new Set<(report: OutputStageReport) => void>();
  return {
    settings,
    get listeners() {
      return listeners.size;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    post(over) {
      const report: OutputStageReport = {
        type: 'outputStage',
        inputLeft: 0,
        inputRight: 0,
        outputLeft: 0,
        outputRight: 0,
        reductionDb: 0,
        overDb: 0,
        active: false,
        ...over,
      };
      for (const listener of listeners) listener(report);
    },
  };
}

describe('watchOutputStage', () => {
  it('subscribes once per stage and shares the watch', () => {
    const stage = fakeStage();
    const first = watchOutputStage(stage);
    expect(watchOutputStage(stage)).toBe(first);
    expect(stage.listeners).toBe(1);
    expect(watchOutputStage(fakeStage())).not.toBe(first);
  });

  it('latches on a report where the stage acted, until reset', () => {
    let now = 100;
    const stage = fakeStage();
    const watch = watchOutputStage(stage, () => now);
    stage.post({ inputLeft: 0.5, outputLeft: 0.5 });
    expect(watch.latched).toBe(false);
    expect(watch.lastActedMs).toBeNull();
    now = 250;
    stage.post({ inputLeft: 2, outputLeft: 0.89, reductionDb: 7, active: true });
    now = 400;
    stage.post({});
    expect(watch.latched).toBe(true);
    expect(watch.lastActedMs).toBe(250);
    watch.resetLatch();
    expect(watch.latched).toBe(false);
    expect(watch.lastActedMs).toBe(250);
  });

  it('judges each report by the mode in force: Off latches above 0 dBFS', () => {
    const stage = fakeStage({ ...DEFAULT_OUTPUT_STAGE, mode: 'off' });
    const watch = watchOutputStage(stage, () => 0);
    stage.post({ outputLeft: 0.99 });
    expect(watch.latched).toBe(false);
    stage.post({ outputLeft: 1.2 });
    expect(watch.latched).toBe(true);
  });
});
