/**
 * Worklet rules 2 and 7 for the part meter bank (windsor#540), measured on
 * V8 rather than read off the source: once its paths have run, its render
 * allocates nothing while its sixteen inputs play stereo, mono, without
 * channels or silent, with a reset and a clear arriving at every step, and no
 * field of the bundle ever changes its representation.
 *
 * Method. As `inserts/delayAllocation.test.ts`: `__fixtures__/workletAllocation.ts`
 * runs the shipped meter bundle's bank processor in a Node of its own
 * (`workletAllocationProbe.ts`) with `--expose-gc`, a 64 MB young generation
 * and `--trace-generalization`, driven by `partMeterBankScenario.ts`. It
 * warms up with the cycle four times, then reads `used_heap_size` in ten
 * windows over two more and counts the collections in it, which must be
 * none. The bank reports every 13 quanta at 48 kHz; the probe's port keeps
 * nothing, so the report's clone, the browser's own allocation, is not
 * counted.
 *
 * Tolerance: 16 KiB over the 1 280 measured quanta, the other worklets'. The
 * eleven readings' own result objects take about 600 bytes each.
 */
import { describe, expect, it } from 'vitest';
import { MUSIC_PARTS_MAX } from '../audioConstants';
import type { BankChangeConfig } from '../__fixtures__/partMeterBankScenario';
import {
  expectAllocationFree,
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import { PART_METER_BANK_NAME } from './partMeterBankConstants';

const TOLERANCE_BYTES = 16 * 1024;
const PERIOD = 128;
const FEEDS: BankChangeConfig['feeds'] = ['stereo', 'mono', 'mixed', 'none', 'quiet'];
const CYCLE = FEEDS.length * PERIOD;

describe('the part meter bank on V8', () => {
  it('meters every input and handles resets and clears without allocating or changing a field representation', () => {
    const scenarioConfig: BankChangeConfig = {
      parts: MUSIC_PARTS_MAX,
      feeds: FEEDS,
      period: PERIOD,
    };
    const run = runAllocationProbe(
      {
        bundle: workletBundle('peak-meter-processor.js'),
        processor: PART_METER_BANK_NAME,
        numberOfInputs: MUSIC_PARTS_MAX,
        rate: 48000,
        params: {},
        options: {},
        messages: [],
        inputChannels: 2,
        loadQuanta: 0,
        warmup: 4 * CYCLE,
        measure: 2 * CYCLE,
        scenario: probeScenario('partMeterBankScenario.ts'),
        scenarioConfig,
      },
      SYNCHRONOUS_TIERING,
    );
    expect(run.changes).toEqual([]);
    expectAllocationFree(run, TOLERANCE_BYTES);
  }, 120_000);
});
