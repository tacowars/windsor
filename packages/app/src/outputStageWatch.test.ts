import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTPUT_STAGE } from '@windsor/engine';
import type { OutputStageReport, OutputStageSettings } from '@windsor/engine';
import { meterView, peakLabel, reportPeaks } from './outputStageModel';
import { OUTPUT_PEAK_SCALE } from './outputStageTables';
import { type MeteredStage, meterRevision, watchOutputStage } from './outputStageWatch';

function fakeStage(settings: OutputStageSettings = DEFAULT_OUTPUT_STAGE): MeteredStage & {
  post(over: Partial<OutputStageReport>): void;
  settings: OutputStageSettings;
  listeners: number;
} {
  const listeners = new Set<(report: OutputStageReport) => void>();
  let revision = 0;
  let latest: OutputStageReport | null = null;
  return {
    settings,
    get revision() {
      return revision;
    },
    read() {
      if (!latest) throw new Error('no report yet');
      return latest;
    },
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
      latest = report;
      revision++;
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

  it('latches in Off on an output above 0 dBFS', () => {
    const stage = fakeStage({ ...DEFAULT_OUTPUT_STAGE, mode: 'off' });
    const watch = watchOutputStage(stage, () => 0);
    stage.post({ outputLeft: 0.99 });
    expect(watch.latched).toBe(false);
    stage.post({ outputLeft: 1.2 });
    expect(watch.latched).toBe(true);
  });

  it('latches on a limiter report delivered after a switch to Off', () => {
    const stage = fakeStage({ ...DEFAULT_OUTPUT_STAGE, mode: 'limiter' });
    const watch = watchOutputStage(stage, () => 0);
    stage.settings = { ...stage.settings, mode: 'off' };
    stage.post({ inputLeft: 2, outputLeft: 0.89, reductionDb: 7, active: true });
    expect(watch.latched).toBe(true);
  });

  it('latches on an Off report above 0 dBFS delivered after a switch to Limiter', () => {
    const stage = fakeStage({ ...DEFAULT_OUTPUT_STAGE, mode: 'off' });
    const watch = watchOutputStage(stage, () => 0);
    stage.settings = { ...stage.settings, mode: 'limiter' };
    stage.post({ inputLeft: 1.3, outputLeft: 1.3 });
    expect(watch.latched).toBe(true);
  });
});

describe('meterRevision (the meters follow the audio, not the transport)', () => {
  it('is -1 with no live stage', () => {
    expect(meterRevision(null)).toBe(-1);
  });

  it('draws each report with the transport stopped: signal, a latch, then idle', () => {
    // The key reads no transport: an audition note, the metronome or a tail
    // after Stop reaches the stage while nothing is sequencing.
    const stage = fakeStage();
    const before = meterRevision(stage);
    stage.post({ inputLeft: 2, inputRight: 1.5, outputLeft: 0.89, reductionDb: 7, active: true });
    const loud = meterRevision(stage);
    expect(loud).not.toBe(before);
    const view = meterView(stage.read(), 'limiter');
    expect(view.peaks[0]).toBeGreaterThan(OUTPUT_PEAK_SCALE.floorDb);
    expect(view.gaugeDb).toBeGreaterThan(0);
    expect(watchOutputStage(stage).latched).toBe(true);

    stage.post({});
    expect(meterRevision(stage)).not.toBe(loud);
    expect(meterView(stage.read(), 'limiter')).toEqual(meterView(null, 'limiter'));
    expect(reportPeaks(stage.read()).map(peakLabel)).toEqual(Array(4).fill('−∞ dBFS'));
    expect(watchOutputStage(stage).latched).toBe(true);
  });
});
