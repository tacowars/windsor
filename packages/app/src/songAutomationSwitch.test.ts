/**
 * A switch lane (windsor#631; record `2026-10-06-insert-switch-lanes`
 * decisions 2 and 9): the picker offers `On` on every insert kind, on a part
 * and on a group, and a new lane starts at the insert's state; every edit
 * leaves steps, values of 0 and 1 only and no
 * bend; Draw paints cells; a click sets a level to the next change; a drag
 * moves a step whole and flips the level it crosses to; a double-click
 * removes a step; and the tools pick these rules by the lane's row.
 */
import { describe, expect, it } from 'vitest';
import { AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';
import { LANE_GROUP } from '@windsor/engine/__fixtures__/groupAutomationSong';
import {
  INSERT_KINDS,
  INSERT_KIND_NAMES,
  TICKS_PER_BAR,
  requireCatalogRow,
  targetRow,
  valueAt,
  type AutomationPoint,
  type AutomationTargetRow,
  type DocumentPart,
  type InsertSpec,
} from '@windsor/engine';
import { currentValue, laneTitle, pickerGroups } from './songAutomationModel';
import { laneEdits } from './songAutomationRules';
import {
  switchAddPoint,
  switchDeletePoint,
  switchMovePoint,
  switchSteps,
  switchStrokePoints,
  switchStrokeTo,
} from './songAutomationSwitch';

const BAR = TICKS_PER_BAR;
const SONG = 8 * BAR;
const GRAIN = { ticks: BAR, songTicks: SONG };
const ROW: AutomationTargetRow = targetRow('insert.f.enabled', () => 'filter')!;
const p = (tick: number, value: number): AutomationPoint => ({ tick, value, bend: 0 });

/** Off over the whole song, as a new lane on an insert that is off starts. */
const OFF = [p(0, 0), p(SONG, 0)];
/** Off, then On over bars 3 and 4 (ticks 2..4 bars). */
const BLOCK = [p(0, 0), p(2 * BAR, 0), p(2 * BAR, 1), p(4 * BAR, 1), p(4 * BAR, 0)];

/** Whether `points` hold only 0 and 1, bend nowhere, and change level only in two-point steps. */
function isSteps(points: readonly AutomationPoint[]): boolean {
  return points.every((q, i) => {
    if (q.bend !== 0 || (q.value !== 0 && q.value !== 1)) return false;
    const prev = points[i - 1];
    if (!prev || prev.value === q.value) return true;
    return prev.tick === q.tick && points[i - 2]?.tick !== q.tick;
  });
}

/** A Draw stroke through `positions`, each a tick and a height, on `original`. */
function stroke(
  original: readonly AutomationPoint[],
  positions: readonly (readonly [number, number])[],
): AutomationPoint[] {
  const samples = new Map<number, number>();
  let last = null;
  for (const [tick, display] of positions) {
    const at = { tick, display };
    switchStrokeTo(samples, last, at, GRAIN);
    last = at;
  }
  return switchStrokePoints(ROW, original, samples, GRAIN);
}

describe("an insert's on/off lane", () => {
  const specOf = (kind: (typeof INSERT_KIND_NAMES)[number], enabled = true): InsertSpec =>
    ({ ...INSERT_KINDS[kind].defaults, kind, id: 'x', enabled }) as InsertSpec;
  const partWith = (spec: InsertSpec): DocumentPart => ({
    ...AUTOMATION_PART,
    strip: { ...AUTOMATION_PART.strip, inserts: [spec] },
    automation: [],
  });
  const switchOption = { target: 'insert.x.enabled', label: 'On', disabled: false };

  it.each(INSERT_KIND_NAMES)('is offered last on a %s, on a part and on a group', (kind) => {
    expect(pickerGroups(partWith(specOf(kind)))[1]!.options.at(-1)).toEqual(switchOption);
    const onGroup = pickerGroups({ ...LANE_GROUP, inserts: [specOf(kind)], automation: [] });
    expect(onGroup[1]!.options.at(-1)).toEqual(switchOption);
  });

  it("starts at the insert's state, named On over the insert", () => {
    const off = partWith(specOf('filter', false));
    expect(currentValue(off, undefined, 'insert.x.enabled')).toBe(0);
    expect(currentValue(partWith(specOf('filter')), undefined, 'insert.x.enabled')).toBe(1);
    expect(laneTitle(off, 'insert.x.enabled')).toEqual({
      name: 'On',
      kindLine: 'Filter',
      kind: 'insert',
    });
  });
});

describe('switchSteps', () => {
  it('keeps the first level and writes each change as a step, dropping what changes nothing', () => {
    const loose = [p(0, 0), p(BAR, 0), p(2 * BAR, 0.8), p(3 * BAR, 1), p(5 * BAR, 0.2)];
    expect(switchSteps(loose)).toEqual([
      p(0, 0),
      p(2 * BAR, 0),
      p(2 * BAR, 1),
      p(5 * BAR, 1),
      p(5 * BAR, 0),
    ]);
    expect(switchSteps(BLOCK)).toEqual(BLOCK);
    expect(switchSteps(OFF)).toEqual([p(0, 0)]);
  });

  it('reads the last point on a tick as what the lane holds from it', () => {
    expect(switchSteps([p(0, 0), p(BAR, 1), p(BAR, 0), p(2 * BAR, 0)])).toEqual([p(0, 0)]);
    expect(switchSteps([p(BAR, 0), p(BAR, 1)])).toEqual([p(BAR, 0), p(BAR, 1)]);
  });
});

describe('a Draw stroke on a switch lane', () => {
  it('holds the cells it crosses at the level drawn, then returns to what the lane held', () => {
    const drawn = stroke(OFF, [
      [2.4 * BAR, 0.9],
      [3.6 * BAR, 0.8],
    ]);
    expect(drawn).toEqual(BLOCK);
    expect(isSteps(drawn)).toBe(true);
    expect(valueAt(ROW, drawn, 3.99 * BAR)).toBe(1);
    expect(valueAt(ROW, drawn, 4 * BAR)).toBe(0);
  });

  it('snaps every height to Off or On, with each change a step and no bend', () => {
    const drawn = stroke(OFF, [
      [0.5 * BAR, 0.1],
      [1.5 * BAR, 0.6],
      [2.5 * BAR, 0.3],
      [3.5 * BAR, 0.7],
      [4.5 * BAR, 0.45],
    ]);
    expect(isSteps(drawn)).toBe(true);
    expect([0, 1, 2, 3, 4].map((bar) => valueAt(ROW, drawn, (bar + 0.5) * BAR))).toEqual([
      0, 1, 0, 1, 0,
    ]);
  });

  it('paints over a block and leaves the lane beyond it as it was', () => {
    const drawn = stroke(BLOCK, [[3.5 * BAR, 0]]);
    expect(drawn).toEqual([p(0, 0), p(2 * BAR, 0), p(2 * BAR, 1), p(3 * BAR, 1), p(3 * BAR, 0)]);
    const past = stroke(BLOCK, [[6.5 * BAR, 1]]);
    expect(past.slice(BLOCK.length)).toEqual([
      p(6 * BAR, 0),
      p(6 * BAR, 1),
      p(7 * BAR, 1),
      p(7 * BAR, 0),
    ]);
  });

  it("runs a stroke to the song's end without a step back there", () => {
    const drawn = stroke(OFF, [
      [6.5 * BAR, 1],
      [SONG, 1],
    ]);
    expect(drawn).toEqual([p(0, 0), p(6 * BAR, 0), p(6 * BAR, 1)]);
  });
});

describe('an Edit click on a switch lane', () => {
  it('holds the clicked level from its tick to the next change', () => {
    expect(switchAddPoint(BLOCK, BAR, 1)).toEqual([
      p(0, 0),
      p(BAR, 0),
      p(BAR, 1),
      p(4 * BAR, 1),
      p(4 * BAR, 0),
    ]);
    expect(switchAddPoint(BLOCK, 3 * BAR, 0)).toEqual([
      p(0, 0),
      p(2 * BAR, 0),
      p(2 * BAR, 1),
      p(3 * BAR, 1),
      p(3 * BAR, 0),
    ]);
  });

  it('changes nothing at the level already held', () => {
    expect(switchAddPoint(BLOCK, BAR, 0)).toBeNull();
    expect(switchAddPoint(BLOCK, 3 * BAR, 1)).toBeNull();
  });
});

describe('a dragged point on a switch lane', () => {
  it('moves a step whole, between the points either side of it', () => {
    const later = switchMovePoint(BLOCK, 2, { tick: 3 * BAR, value: 1 });
    expect(later).toEqual([p(0, 0), p(3 * BAR, 0), p(3 * BAR, 1), p(4 * BAR, 1), p(4 * BAR, 0)]);
    const earlier = switchMovePoint(BLOCK, 1, { tick: BAR, value: 0 });
    expect(earlier).toEqual([p(0, 0), p(BAR, 0), p(BAR, 1), p(4 * BAR, 1), p(4 * BAR, 0)]);
    expect(switchMovePoint(BLOCK, 2, { tick: 6 * BAR, value: 1 })).toEqual([p(0, 0)]);
  });

  it('flips the level by crossing the middle', () => {
    expect(switchMovePoint(BLOCK, 2, { tick: 2 * BAR, value: 0 })).toEqual([p(0, 0)]);
    expect(switchMovePoint(OFF, 1, { tick: 5 * BAR, value: 1 })).toEqual([
      p(0, 0),
      p(5 * BAR, 0),
      p(5 * BAR, 1),
    ]);
  });

  it("flips the span before a step from the step's first point", () => {
    expect(switchMovePoint(BLOCK, 1, { tick: 2 * BAR, value: 1 })).toEqual([
      p(0, 1),
      p(4 * BAR, 1),
      p(4 * BAR, 0),
    ]);
    // The block's own span turns Off, so both its steps merge away.
    expect(switchMovePoint(BLOCK, 3, { tick: 4 * BAR, value: 0 })).toEqual([p(0, 0)]);
  });
});

describe('a double-click on a switch lane', () => {
  it('removes a step whole, joining the levels either side of it', () => {
    expect(switchDeletePoint(BLOCK, 3)).toEqual([p(0, 0), p(2 * BAR, 0), p(2 * BAR, 1)]);
    expect(switchDeletePoint([p(0, 1)], 0)).toEqual([p(0, 1)]);
  });
});

describe('the rules a lane takes', () => {
  it('are the switch rules, with no bend, on an insert switch, and the curve rules elsewhere', () => {
    expect(laneEdits(ROW).bends).toBe(false);
    expect(laneEdits(ROW).add(BLOCK, { tick: BAR, value: 1, onLine: true })).toEqual(
      switchAddPoint(BLOCK, BAR, 1),
    );
    const level = laneEdits(requireCatalogRow('strip.level'));
    expect(level.bends).toBe(true);
    expect(level.add([p(0, 0.5)], { tick: BAR, value: 0.25, onLine: false })).toEqual([
      p(0, 0.5),
      p(BAR, 0.25),
    ]);
  });
});
