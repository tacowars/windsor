/**
 * The modulation lanes' rules (windsor#31): the picker's limits, the
 * painting maths (pointer → value with the snap at 0, the cells a drag
 * crosses), the double-click reset, the readout through the engine's curve,
 * and a lane's round trip through the document when the step count changes.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { GridSpec, GridStep, StepModLane, StepModParam } from '@windsor/engine';
import {
  ARRANGEMENT_VERSION,
  gridNote,
  STEP_MOD_LANES_MAX,
  STEP_MOD_PARAMS,
  partAt,
} from '@windsor/engine';
import { loadBuiltIns } from './builtInLibrary';
import { DocumentModel } from './documentModel';
import { slideAt, stepsForLength } from './gridModel';
import {
  addLane,
  canAddLane,
  cellAtX,
  freeParams,
  heldBySlide,
  type LaneHold,
  laneReadout,
  lanesForSteps,
  offsetLabel,
  paintSpan,
  removeLane,
  resetCell,
  settle,
  valueAtY,
  withLaneValues,
} from './stepModLaneModel';

beforeAll(() => loadBuiltIns());

const lane = (param: StepModLane['param'], values: number[]): StepModLane => ({ param, values });

describe('adding and removing lanes', () => {
  it('adds a lane of zeros, one per step, and offers the rest', () => {
    const lanes = addLane([], 'filter.cutoff', 16);
    expect(lanes).toEqual([lane('filter.cutoff', new Array<number>(16).fill(0))]);
    expect(freeParams(lanes!)).not.toContain('filter.cutoff');
    expect(freeParams(lanes!)).toHaveLength(STEP_MOD_PARAMS.length - 1);
  });

  it('refuses the same parameter twice', () => {
    const lanes = addLane([], 'ops.1.level', 4)!;
    expect(addLane(lanes, 'ops.1.level', 4)).toBeNull();
  });

  it('enforces the engine limit', () => {
    let lanes: StepModLane[] = [];
    for (const param of STEP_MOD_PARAMS.slice(0, STEP_MOD_LANES_MAX)) {
      lanes = addLane(lanes, param, 2)!;
    }
    expect(lanes).toHaveLength(STEP_MOD_LANES_MAX);
    expect(canAddLane(lanes)).toBe(false);
    expect(addLane(lanes, STEP_MOD_PARAMS[STEP_MOD_LANES_MAX]!, 2)).toBeNull();
  });

  it('removes a lane and lets it be re-added, empty', () => {
    const painted = [lane('filter.cutoff', [0.5, -0.5]), lane('ops.0.level', [0, 1])];
    const removed = removeLane(painted, 0);
    expect(removed).toEqual([painted[1]]);
    expect(addLane(removed, 'filter.cutoff', 2)).toEqual([
      painted[1],
      lane('filter.cutoff', [0, 0]),
    ]);
  });
});

describe('painting', () => {
  const band = { top: 100, height: 40 };

  it('maps the top to +1, the centre to 0 and the bottom to -1', () => {
    expect(valueAtY(100, band)).toBe(1);
    expect(valueAtY(120, band)).toBe(0);
    expect(valueAtY(140, band)).toBe(-1);
    expect(valueAtY(90, band)).toBe(1);
    expect(valueAtY(150, band)).toBe(-1);
    expect(valueAtY(113, band)).toBe(0.35);
  });

  it('snaps to 0 within the band and holds two decimals', () => {
    expect(settle(0.049)).toBe(0);
    expect(settle(-0.049)).toBe(0);
    expect(Object.is(settle(-0.01), 0)).toBe(true);
    expect(settle(0.05)).toBe(0.05);
    expect(settle(0.123456)).toBe(0.12);
    expect(settle(2)).toBe(1);
  });

  it('finds the cell under the pointer, a gap or an overshoot picking the nearest', () => {
    const cells = [0, 1, 2, 3].map((i) => ({ left: i * 49, right: i * 49 + 46 }));
    expect(cellAtX(10, cells)).toBe(0);
    expect(cellAtX(50, cells)).toBe(1);
    expect(cellAtX(47, cells)).toBe(0);
    expect(cellAtX(-30, cells)).toBe(0);
    expect(cellAtX(900, cells)).toBe(3);
  });

  it('sets the pressed cell alone', () => {
    expect(paintSpan([0, 0, 0], null, { index: 1, value: 0.5 })).toEqual([0, 0.5, 0]);
  });

  it('sets every cell a drag crosses, on the line between its ends', () => {
    const from = { index: 0, value: 0.2 };
    const painted = paintSpan([0.2, 0, 0, 0, 0], from, { index: 4, value: 1 });
    expect(painted).toEqual([0.2, 0.4, 0.6, 0.8, 1]);
    const back = paintSpan(painted, { index: 4, value: 1 }, { index: 2, value: -1 });
    expect(back).toEqual([0.2, 0.4, -1, 0, 1]);
  });

  it('snaps a crossed cell near 0 to 0', () => {
    const painted = paintSpan([0, 0, 0], { index: 0, value: -0.5 }, { index: 2, value: 0.54 });
    expect(painted).toEqual([0, 0, 0.54]);
  });

  it('writes one lane of the list and resets one cell', () => {
    const lanes = [lane('filter.cutoff', [0.5, 0.5]), lane('ops.0.level', [1, 1])];
    const reset = resetCell(lanes[1]!.values, 0);
    expect(reset).toEqual([0, 1]);
    expect(withLaneValues(lanes, 1, reset)).toEqual([lanes[0], lane('ops.0.level', [0, 1])]);
  });
});

describe('the readout', () => {
  it('reads an octave row in octaves and plays through the engine curve', () => {
    expect(laneReadout('filter.cutoff', 0.5, 1000)).toBe('+2.3 oct → 4.76k');
    expect(laneReadout('filter.cutoff', -0.5, undefined)).toBe('-2.3 oct');
  });

  it('reads a linear row in its own units and clamps to its bounds', () => {
    expect(laneReadout('ops.1.level', 0.5, 0.8)).toBe('+0.25 → 1.00');
    expect(laneReadout('filter.envAmount', -0.35, 0)).toBe('-2.10 → -2.10');
  });

  it('reads a log row as the lane value', () => {
    expect(laneReadout('ops.0.env.decayTime', 0.35, undefined)).toBe('+0.35');
  });

  it('shows the patch value itself at 0', () => {
    expect(laneReadout('filter.cutoff', 0, 1200)).toBe('+0.0 oct → 1.20k');
  });

  it('labels an offset for every curve', () => {
    const row = { param: 'filter.cutoff', curve: 'octaves', span: 4, min: 1, max: 2 } as const;
    expect(offsetLabel({ ...row, slideKeeps: false }, 0.25)).toBe('+1.0 oct');
  });
});

describe('a lane in the document', () => {
  const SONG = {
    version: ARRANGEMENT_VERSION,
    transport: { bpm: 120, bars: 1 },
    parts: [
      {
        slot: 0,
        name: 'lead',
        preset: 'saw-arp',
        regions: [{ start: 0, duration: 384 }],
        sequencer: { kind: 'grid', seed: 0 },
      },
    ],
  };
  const grid = (model: DocumentModel): GridSpec => partAt(model.doc, 0)!.sequencer as GridSpec;

  it('survives export and import, and follows the step count', () => {
    const model = new DocumentModel(SONG);
    const steps = grid(model).steps.length;
    const added = addLane(grid(model).lanes, 'filter.cutoff', steps)!;
    const painted = withLaneValues(
      added,
      0,
      paintSpan(added[0]!.values, null, { index: 1, value: 0.5 }),
    );
    model.merge({ parts: { 0: { sequencer: { lanes: painted } } } });
    const longer = stepsForLength(grid(model).steps, steps + 4);
    const lanes = lanesForSteps(grid(model).lanes, longer.length);
    model.merge({ parts: { 0: { sequencer: { steps: longer, length: longer.length, lanes } } } });
    expect(model.corrections).toEqual([]);
    expect(grid(model).lanes[0]!.values).toHaveLength(steps + 4);
    expect(grid(model).lanes[0]!.values[1]).toBe(0.5);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
    expect(reopened.corrections).toEqual([]);
  });

  it('pads a short lane and trims a long one on import', () => {
    const steps = [{ kind: 'note', degree: 0 }, { kind: 'rest' }, { kind: 'tie' }];
    const open = (values: number[]): readonly number[] =>
      grid(
        new DocumentModel({
          ...SONG,
          parts: [
            {
              ...SONG.parts[0],
              sequencer: { kind: 'grid', steps, lanes: [{ param: 'ops.0.level', values }] },
            },
          ],
        }),
      ).lanes[0]!.values;
    expect(open([0.5])).toEqual([0.5, 0, 0]);
    expect(open([0.5, 0.25, -0.25, 1])).toEqual([0.5, 0.25, -0.25]);
  });

  it('pads and trims every lane to a step count', () => {
    const lanes = [lane('filter.cutoff', [0.5, 0.25])];
    expect(lanesForSteps(lanes, 4)).toEqual([lane('filter.cutoff', [0.5, 0.25, 0, 0])]);
    expect(lanesForSteps(lanes, 1)).toEqual([lane('filter.cutoff', [0.5])]);
  });
});

describe('a slide holds what the voice keeps (windsor#31)', () => {
  const KEY = { root: 0, scale: 'naturalMinor' } as const;
  const slide = (degree: number): GridStep => gridNote(degree, { slide: true });
  const line = [gridNote(0), slide(2), slide(2), gridNote(4)];
  const hold = (steps: GridStep[], index: number, param: StepModParam, skipChance = 0): LaneHold =>
    heldBySlide(slideAt({ steps, length: steps.length, skipChance }, index, KEY), param);

  it('holds feedback on a slide to a new pitch, but not the cutoff on the same step', () => {
    expect(hold(line, 1, 'ops.0.feedback')).toBe('held');
    expect(hold(line, 1, 'ops.2.env.decayCurve')).toBe('held');
    expect(hold(line, 1, 'filter.cutoff')).toBe('plays');
    expect(hold(line, 1, 'ops.1.level')).toBe('plays');
  });

  it('holds every lane on a slide to the held pitch, which sends no note-on', () => {
    for (const param of STEP_MOD_PARAMS) expect(hold(line, 2, param), param).toBe('held');
  });

  it('never holds a step without a slide', () => {
    for (const index of [0, 3]) {
      for (const param of STEP_MOD_PARAMS) expect(hold(line, index, param), param).toBe('plays');
    }
  });

  it("leaves a slide on the loop's first step to the run: held once looping, played on entry", () => {
    const steps = [slide(0), gridNote(0)];
    expect(hold(steps, 0, 'filter.cutoff')).toBe('depends');
    expect(hold([slide(0), gridNote(3)], 0, 'ops.0.feedback')).toBe('depends');
    expect(hold([slide(0), gridNote(3)], 0, 'filter.cutoff')).toBe('plays');
  });

  it('leaves a slide after a note Skip can drop to the run', () => {
    expect(hold(line, 2, 'filter.cutoff', 0.1)).toBe('depends');
    expect(hold(line, 1, 'ops.0.feedback', 0.1)).toBe('depends');
    expect(hold(line, 3, 'ops.0.feedback', 0.1)).toBe('plays');
  });

  it('says so in the readout instead of a played value', () => {
    const always = { kind: 'retarget', when: 'always' } as const;
    expect(laneReadout('ops.0.feedback', 0.35, 0, always)).toBe('+0.35 · held by slide');
    expect(laneReadout('filter.cutoff', 0.5, 1000, always)).toBe('+2.3 oct → 4.76k');
    expect(laneReadout('filter.cutoff', 0.5, 1000, { kind: 'same', when: 'always' })).toBe(
      '+2.3 oct · held by slide',
    );
    expect(laneReadout('ops.0.feedback', 0.35, 0, { kind: 'retarget', when: 'wrap' })).toBe(
      '+0.35 · held by slide once looping',
    );
    expect(laneReadout('ops.0.feedback', 0.35, 0, { kind: 'same', when: 'skip' })).toBe(
      '+0.35 · held by slide unless skipped',
    );
  });
});
