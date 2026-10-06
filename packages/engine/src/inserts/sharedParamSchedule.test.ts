/**
 * A param two insert fields share (windsor#345, Codex's P1 on PR #384): its
 * schedule is the stage's own mapping of both fields' values at each
 * breakpoint either has, whichever lane the player schedules first, so a
 * step on one lane never leaks back across the other's events. Every shared
 * pair in `INSERT_AUTOMATION_FIELDS`, each field in turn as the one that
 * steps; the expected value is the stage's `set` at both fields' values then.
 *
 * Between two breakpoints the shared param runs straight, which is exact
 * only where the stage's mapping is linear in the field that moves, so each
 * lane here has a breakpoint at every time a test reads.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { installParamWorklet } from '../__fixtures__/insertParamRig';
import type { Built } from '../__fixtures__/insertStageRig';
import {
  build,
  fieldValue,
  openSpec,
  otherValue,
  touched,
  withField,
} from '../__fixtures__/insertStageRig';
import { INSERT_AUTOMATION_FIELDS } from '../automation/automationInsertTables';
import type { AutomationTargetRow } from '../automation/automationLane';
import type { InsertKindName } from './insertRegistry';

const undo = installParamWorklet();
afterAll(undo);

/** The player's de-click on a step. */
const STEP = 0.004;
/** Close enough for the same arithmetic in another order. */
const DIGITS = 12;

/** Every pair of fields that writes one param together. */
const SHARED: readonly (readonly [InsertKindName, string, string])[] = [
  ['drive', 'drive', 'mix'],
  ['chorus', 'depth', 'spread'],
  ['ensemble', 'width', 'mix'],
];
/** Each pair with each field as the one that steps or is edited (`a`) while the other plays (`b`). */
const CASES = SHARED.flatMap(([kind, x, y]) => [
  { kind, a: x, b: y },
  { kind, a: y, b: x },
]);

interface Case {
  readonly kind: InsertKindName;
  readonly a: string;
  readonly b: string;
}

type Point = readonly [time: number, value: number];

/** Piecewise linear through `points`, held past the ends. */
function linear(points: readonly Point[], t: number): number {
  const [first] = points;
  if (t <= first![0]) return first![1];
  for (let i = 1; i < points.length; i++) {
    const [t0, v0] = points[i - 1]!;
    const [t1, v1] = points[i]!;
    if (t <= t1) return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return points[points.length - 1]![1];
}

/** A case's rig: values in range for both fields, and the shared param's names. */
function rig(c: Case) {
  const spec = openSpec(c.kind);
  const rows = INSERT_AUTOMATION_FIELDS[c.kind] as readonly AutomationTargetRow[];
  const row = (field: string) => rows.find((r) => r.target === field)!;
  const value = (field: string, share: number) =>
    otherValue(row(field), fieldValue(spec, field), share);
  const reach = (field: string): string[] => {
    const probe = build(spec);
    probe.stage.param!(field)!.hold(value(field, 0.5), 0);
    return touched(probe);
  };
  const ofB = reach(c.b);
  const shared = reach(c.a).filter((name) => ofB.includes(name));
  /** What the stage's `set` writes to the shared params at `va` and `vb`. */
  const want = (va: number, vb: number): number => {
    const knob = build(withField(withField(spec, c.a, va), c.b, vb));
    return knob.params.get(shared[0]!)!.value;
  };
  /** `b`'s points at `times`, each value somewhere else in its range. */
  const laneOfB = (times: readonly number[]): Point[] =>
    times.map((t, i) => [t, value(c.b, (0.1 + 0.37 * (i + 1)) % 1)]);
  return { spec, value, shared, ofB, want, laneOfB };
}

/** `points` through `field`'s handle: a hold at time 0, ramps after. */
function playLane(lane: Built, field: string, points: readonly Point[]): void {
  const handle = lane.stage.param!(field)!;
  for (const [t, v] of points) {
    if (t === 0) handle.hold(v, t);
    else handle.schedule(v, t, 'ramp');
  }
}

/** Every shared param at `time` equals `expected`. */
function expectShared(lane: Built, shared: readonly string[], time: number, expected: number) {
  for (const name of shared) {
    const got = lane.params.get(name)!.valueAt(time);
    expect(got, `${name} at ${time}`).toBeCloseTo(expected, DIGITS);
  }
}

describe('a shared param follows both lanes at once', () => {
  it('finds a shared param for every pair', () => {
    for (const c of CASES) expect(rig(c).shared.length, `${c.kind} ${c.a}`).toBeGreaterThan(0);
  });

  const ORDERS = CASES.flatMap((c) => ['a', 'b'].map((first) => ({ ...c, first })));

  it.each(ORDERS)('$kind: a step on $a while $b ramps across it, $first scheduled first', (c) => {
    const { spec, value, shared, want, laneOfB } = rig(c);
    const [a0, a1] = [value(c.a, 0.2), value(c.a, 0.8)];
    const [start, ...window] = laneOfB([0, 0.5, 2]);
    const lane = build(spec);
    const a = lane.stage.param!(c.a)!;
    a.hold(a0, 0);
    playLane(lane, c.b, [start!]);
    // One tick's window per lane, as the player issues them: a step at 1 on `a`.
    const stepA = (): void => {
      a.schedule(a0, 1, 'set');
      a.schedule(a1, 1 + STEP, 'ramp');
    };
    const rampB = (): void => playLane(lane, c.b, window);
    if (c.first === 'a') [stepA, rampB].forEach((f) => f());
    else [rampB, stepA].forEach((f) => f());
    const bAt = (t: number) => linear([start!, ...window], t);
    for (const t of [0, 0.5, 1]) expectShared(lane, shared, t, want(a0, bAt(t)));
    for (const t of [1 + STEP, 2, 3]) expectShared(lane, shared, t, want(a1, bAt(t)));
  });

  it.each(CASES)('$kind: $a held, cancelled or released leaves $b playing', (c) => {
    const { spec, value, shared, ofB, want, laneOfB } = rig(c);
    const [a0, a1, a2] = [value(c.a, 0.2), value(c.a, 0.8), value(c.a, 0.5)];
    const points = laneOfB([0, 0.5, 1, 1.5, 2, 3]);
    const [before, after] = [points.slice(0, -1), points.slice(-1)];
    const bAt = (t: number) => linear(points, t);
    const play = (edit: (lane: Built) => void): Built => {
      const lane = build(spec);
      const a = lane.stage.param!(c.a)!;
      a.hold(a0, 0);
      a.schedule(a1, 2, 'ramp');
      playLane(lane, c.b, before);
      edit(lane);
      playLane(lane, c.b, after);
      return lane;
    };
    const aSpec = fieldValue(spec, c.a);
    const held = play((l) => l.stage.param!(c.a)!.hold(a2, 1));
    const cancelled = play((l) => l.stage.param!(c.a)!.cancelFrom(1));
    const released = play((l) => l.stage.param!(c.a)!.release(1));
    const lanes = [held, cancelled, released];
    // Each edit at 1 drops `a`'s ramp to 2, so `a` holds a0 until then, as Web Audio does.
    for (const t of [0, 0.5]) {
      for (const lane of lanes) expectShared(lane, shared, t, want(a0, bAt(t)));
    }
    for (const t of [1, 1.5, 2, 3]) {
      expectShared(held, shared, t, want(a2, bAt(t)));
      expectShared(cancelled, shared, t, want(a0, bAt(t)));
      expectShared(released, shared, t, want(aSpec, bAt(t)));
    }
    // `b`'s own params play on as a lane of their own would.
    const alone = build(spec);
    playLane(alone, c.b, points);
    for (const name of ofB.filter((n) => !shared.includes(n))) {
      const solo = alone.params.get(name)!;
      for (const lane of lanes) {
        for (const t of [1.5, 2.5, 3]) {
          expect(lane.params.get(name)!.valueAt(t), name).toBe(solo.valueAt(t));
        }
      }
    }
  });

  it.each(CASES)('$kind: $a without a lane is its knob while $b plays', (c) => {
    const { spec, shared, want, laneOfB } = rig(c);
    const points = laneOfB([0, 1, 2]);
    const lane = build(spec);
    playLane(lane, c.b, points);
    const aSpec = fieldValue(spec, c.a);
    for (const t of [0, 1, 2, 3]) expectShared(lane, shared, t, want(aSpec, linear(points, t)));
  });
});

describe("a native kind's switch shares the wet and dry gains with Mix (windsor#628)", () => {
  const SWITCHED = ['drive', 'chorus', 'ensemble', 'echo'] as const;

  it.each(SWITCHED)('%s: the switch steps off at 1 and on at 2 while Mix ramps across', (kind) => {
    const spec = openSpec(kind);
    const mixRow = INSERT_AUTOMATION_FIELDS[kind].find((r) => r.target === 'mix')!;
    const mix: Point[] = [0.2, 0.5, 0.8, 0.4].map((share, t) => [t, otherValue(mixRow, -1, share)]);
    const lane = build(spec);
    const toggle = lane.stage.param!('enabled')!;
    toggle.hold(1, 0);
    toggle.schedule(0, 1, 'set');
    toggle.schedule(1, 2, 'set');
    const gains = touched(lane);
    playLane(lane, 'mix', mix);
    /** What `set` writes to the switch's gains at `mixValue`, switched `on` or off. */
    const want = (mixValue: number, on: boolean): Map<string, number> => {
      const knob = build({ ...withField(spec, 'mix', mixValue), enabled: on } as typeof spec);
      return new Map(gains.map((name) => [name, knob.params.get(name)!.value]));
    };
    const expectAt = (t: number, on: boolean) => {
      for (const [name, value] of want(linear(mix, t), on)) {
        expect(lane.params.get(name)!.valueAt(t), `${name} at ${t}`).toBeCloseTo(value, DIGITS);
      }
    };
    expect(gains.length).toBeGreaterThan(1);
    for (const t of [0, 0.5, 0.9]) expectAt(t, true);
    for (const t of [1, 1.5, 1.9]) expectAt(t, false);
    for (const t of [2, 2.5, 3]) expectAt(t, true);
  });
});
