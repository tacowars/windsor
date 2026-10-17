/**
 * Worklet rules 2 and 7 for Spectre (records `2026-10-16-spectre-insert` and
 * `2026-10-17-spectre-drawn-cells`), measured on V8 as
 * `pumpAllocation.test.ts` measures the Pump: once its paths have run, its
 * render allocates nothing through every resolution, overlap and window
 * (each a fade and rebuild), every input modulation, the curves' moves and
 * selects, Follow off, on the key and on chords, new cells posted smooth
 * and stepped, linked and not, Freeze in
 * both modes, the LFO's shapes and slots, the scope, Listen, the switch and
 * the input's three shapes, and no field of the bundle ever changes its
 * representation. The probe's port drops what the processor posts, so the
 * scope's reports cost the render nothing here; in Chrome a report is a
 * structured clone, which only an open workbench pays for.
 *
 * Tolerance: 16 KiB over the measured quanta, the Pump's, after a warm-up
 * long enough for every path to reach its last tier (`WARM_CYCLES`).
 */
import { describe, expect, it } from 'vitest';
import type {
  SpectreChangeConfig,
  SpectreChangeStep,
  SpectreInput,
} from '../__fixtures__/spectreChangeScenario';
import { spectreCellPayload, spectreRampCells } from './spectreCells';
import type { SpectreCellSource } from './spectreCells';
import {
  expectAllocationFree,
  probeScenario,
  runAllocationProbe,
  SYNCHRONOUS_TIERING,
  workletBundle,
} from '../__fixtures__/workletAllocation';
import type { ProbeRun } from '../__fixtures__/workletAllocation';

const TOLERANCE_BYTES = 16 * 1024;
const PERIOD = 160;
const QUIET = 16;

/** The processor's parameters, in the order of each row below. */
const NAMES = [
  'bands',
  'overlap',
  'window',
  'mod',
  'modA',
  'modB',
  'modC',
  'lfoShape',
  'lfoHz',
  'lfoDepth1',
  'lfoDepth2',
  'lfoDepth3',
  'freeze',
  'enabled',
  'delayShift',
  'gainOffset',
  'spread',
  'scatter',
  'gridMs',
  'timeMs',
  'lfoDest1',
  'freezeMode',
  'delaySelect',
  'mix',
  'follow',
  'pitches',
];
/** Follow's pitch classes the steps hand in turn: every class, a major key, two triads. */
const PITCHES = [0xfff, 0b101010110101, 0b000010010001, 0b000100100001];

/** Two cell payloads to post: stepped and unlinked under a selection, then smooth and linked. */
const SOURCES: SpectreCellSource[] = [
  {
    curves: {
      gain: { left: spectreRampCells(0.3, 1), link: true, steps: true },
      delay: {
        left: spectreRampCells(0.1, 0.8),
        right: spectreRampCells(0.8, 0.1),
        link: false,
        steps: true,
      },
      feedback: { left: spectreRampCells(0.7, 0.2), link: true, steps: false },
    },
    selection: [[20, 90]],
  },
  {
    curves: {
      gain: { left: spectreRampCells(1, 0.6), link: true, steps: false },
      delay: { left: spectreRampCells(0.5, 0.2), link: true, steps: false },
      feedback: { left: spectreRampCells(0.3, 0.6), link: true, steps: true },
    },
    selection: [],
  },
];
const CELLS = SOURCES.map((source) => Array.from(spectreCellPayload(source)));
const post = (type: string, enabled: boolean) => ({ type, enabled });
/** The messages each step posts at its start, by step. */
const MESSAGES: Record<number, { type: string; enabled?: boolean; cells?: number[] }[]> = {
  0: [{ type: 'cells', cells: CELLS[0]! }, post('scope', true)],
  2: [post('listen', true)],
  4: [post('listen', false), { type: 'cells', cells: CELLS[1]! }],
  7: [post('scope', false)],
  9: [{ type: 'cells', cells: CELLS[0]! }, post('scope', true)],
};

/** One step a row: its parameter values and its input. */
const STEPS: [number[], SpectreInput][] = [
  [
    [
      2, 1, 0, 1, 0.5, 0.5, 0.5, 0, 0.5, 0.3, 0.2, 0.1, 0, 1, 0, 0, 0, 0, 125, 1000, 2, 1, 0.75,
      0.5,
    ],
    'stereo',
  ],
  [
    [
      0, 2, 1, 2, 0.8, 0.6, 0.3, 1, 4, -0.2, 0.5, 0.4, 0, 1, 1.5, -0.2, 0.5, 0.3, 0, 600, 3, 0.4,
      0.2, 1,
    ],
    'mono',
  ],
  [
    [
      1, 0, 2, 3, 0.7, 0.9, 0.1, 2, 9, 0.5, -0.5, -0.3, 0, 1, -2, 0.1, -1, 0.1, 62.5, 2400, 3, 0.6,
      0.9, 0.7,
    ],
    'stereo',
  ],
  [
    [3, 1, 0, 4, 0.2, 0.5, 0.5, 3, 0.1, 0, 0, 0, 1, 1, 0.5, 0, 0, 0, 0, 300, 2, 1, 0.5, 0.8],
    'none',
  ],
  [
    [2, 2, 0, 5, 1, 0.3, 0.2, 4, 2, 0.8, 0, 0.5, 0, 1, 0, 0, 2, 0, 250, 5000, 4, 0.3, 0.1, 0.6],
    'stereo',
  ],
  [[4, 1, 1, 6, 0.9, 1, 0.8, 0, 0.5, 0, 0.3, 0, 0, 1, 3, 0.3, 0, 0.8, 0, 8000, 2, 1, 1, 1], 'mono'],
  [
    [0, 1, 0, 7, 0.5, 0.3, 0.6, 1, 1, 0.1, 0.1, 0.1, 0, 0, 0, 0, 0, 0, 125, 1000, 2, 1, 0.75, 0.5],
    'stereo',
  ],
  [
    [2, 1, 0, 8, 0.6, 0.8, 0, 2, 3, 0, 0, 0, 0, 1, -1, 0, 0.5, 0.2, 0, 1000, 2, 1, 0.75, 0.5],
    'stereo',
  ],
  [
    [1, 2, 2, 9, 1, 1, 0, 3, 6, 0.2, 0.2, 0.2, 0, 1, 0, -0.5, 0, 0, 31.25, 1500, 5, 0.5, 0.3, 0.9],
    'none',
  ],
  [
    [2, 1, 0, 10, 1, 0.5, 0.5, 4, 0.3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 125, 1000, 2, 1, 0.75, 0.5],
    'stereo',
  ],
  [
    [2, 1, 0, 11, 0.5, 0.5, 0, 0, 0.3, 0, 0, 0.6, 0, 1, 0, 0, 0, 0, 125, 1000, 2, 1, 0.75, 0.5],
    'mono',
  ],
  [
    [2, 1, 0, 0, 0.5, 0.5, 0.5, 0, 0.3, 0, 0, 0, 1, 1, 0, 0, 0, 0, 125, 1000, 2, 1, 0.75, 0.5],
    'stereo',
  ],
];
const CYCLE = STEPS.length * PERIOD;
/**
 * Whole cycles before the measured one. The two `frame` methods are small
 * bodies around heavy callees, so they gather V8's tier-up budget slowly: on
 * the M1 under Node 24 one reaches TurboFan in the twelfth cycle, a one-time
 * compile of about 16 KB that the probe would otherwise read as growth.
 */
const WARM_CYCLES = 16;

function probe(): ProbeRun {
  const steps = STEPS.map(([values, input], i): SpectreChangeStep => ({
    names: NAMES,
    values: [...values, i % 3, PITCHES[i % PITCHES.length]!],
    input,
    messages: MESSAGES[i] ?? [],
  }));
  const scenarioConfig: SpectreChangeConfig = { steps, period: PERIOD, quiet: QUIET };
  return runAllocationProbe(
    {
      bundle: workletBundle('spectre-processor.js'),
      rate: 48000,
      params: {},
      options: {},
      messages: [],
      inputChannels: 2,
      loadQuanta: 0,
      warmup: WARM_CYCLES * CYCLE,
      measure: CYCLE,
      scenario: probeScenario('spectreChangeScenario.ts'),
      scenarioConfig,
    },
    SYNCHRONOUS_TIERING,
  );
}

describe('Spectre on V8', () => {
  it('rebuilds, modulates, moves every control, takes new cells, scopes, listens, freezes and switches without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expectAllocationFree(run, TOLERANCE_BYTES);
  }, 300_000);
});
