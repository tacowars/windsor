/**
 * Every insert kind's lane handles (windsor#345, record
 * `2026-10-01-song-automation-lanes` decisions 1 and 2), for every field the
 * catalog lists, checked against the stage's own `set`:
 *
 * - a ramp through `stage.param(field)` reaches exactly the params `set`
 *   would change for that field, with the values `set` would write, so a
 *   field `set` maps to several params moves all of them consistently;
 * - while the handle is engaged, a knob edit to every field applies to every
 *   other param and leaves the lane's params as the lane holds them;
 * - the release writes the knob's value back, as `set` would have.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { graphParams, installParamWorklet } from '../__fixtures__/insertParamRig';
import { INSERT_AUTOMATION_FIELDS } from '../automation/automationInsertTables';
import type { AutomationTargetRow } from '../automation/automationLane';
import type { InsertKindName, InsertSpec, InsertStage } from './insertRegistry';
import { INSERT_KINDS, INSERT_KIND_NAMES } from './insertRegistry';

const undo = installParamWorklet();
afterAll(undo);

/**
 * Each kind's defaults, switched on, with both delay sides free: a synced
 * side's time comes from the tempo, so `set` would not show the field.
 */
function openSpec(kind: InsertKindName): InsertSpec {
  const spec = { ...INSERT_KINDS[kind].defaults, enabled: true } as InsertSpec;
  return spec.kind === 'delay' ? { ...spec, leftSync: false, rightSync: false } : spec;
}

/** `spec` with the catalog field `field` (`bands.3.freq` included) at `value`. */
function withField(spec: InsertSpec, field: string, value: number): InsertSpec {
  const put = (node: unknown, path: readonly string[]): unknown => {
    const [head, ...rest] = path;
    const child = rest.length === 0 ? value : undefined;
    if (Array.isArray(node)) {
      return node.map((item, i) => (String(i) === head ? (child ?? put(item, rest)) : item));
    }
    const record = node as Record<string, unknown>;
    return { ...record, [head!]: child ?? put(record[head!], rest) };
  };
  return put(spec, field.split('.')) as InsertSpec;
}

/** A value in `row`'s range away from `from`, and a second one away from both. */
function otherValue(row: AutomationTargetRow, from: number, share = 0.37): number {
  const at = (s: number): number => row.min + s * (row.max - row.min);
  return at(share) === from ? at(share + 0.24) : at(share);
}

const fieldValue = (spec: InsertSpec, field: string): number =>
  field
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], spec) as number;

interface Built {
  readonly stage: InsertStage<InsertSpec>;
  readonly params: ReadonlyMap<string, FakeParam>;
}

function build(spec: InsertSpec): Built {
  const context = new FakeContext();
  const stage = INSERT_KINDS[spec.kind].create(context.asAudioContext(), spec);
  const params = new Map(graphParams(context).map(({ name, param }) => [name, param]));
  for (const param of params.values()) param.automation.length = 0;
  return { stage, params };
}

const values = (built: Built): Map<string, number> =>
  new Map([...built.params].map(([name, param]) => [name, param.value]));
const touched = (built: Built): string[] =>
  [...built.params].filter(([, p]) => p.automation.length > 0).map(([name]) => name);

/** `spec` with every catalog field of its kind moved to another value. */
function everyKnobMoved(spec: InsertSpec): InsertSpec {
  let next = spec;
  for (const row of INSERT_AUTOMATION_FIELDS[spec.kind]) {
    next = withField(next, row.target, otherValue(row, fieldValue(spec, row.target), 0.71));
  }
  return next;
}

const cases = INSERT_KIND_NAMES.flatMap((kind) =>
  INSERT_AUTOMATION_FIELDS[kind].map((row) => ({ kind, row, field: row.target })),
);

describe('stage.param, every kind and every catalog field', () => {
  it('covers all twelve kinds', () => {
    expect(new Set(cases.map((c) => c.kind)).size).toBe(INSERT_KIND_NAMES.length);
  });

  it.each(cases)('$kind $field: a ramp reaches the params set writes, with its values', (c) => {
    const spec = openSpec(c.kind);
    const value = otherValue(c.row, fieldValue(spec, c.field));
    const lane = build(spec);
    const knob = build(spec);
    lane.stage.param!(c.field)!.schedule(value, 1, 'ramp');
    knob.stage.set(withField(spec, c.field, value));
    const after = values(knob);
    const ramped = touched(lane);
    expect(ramped.length).toBeGreaterThan(0);
    for (const [name, param] of lane.params) {
      if (ramped.includes(name)) {
        expect(param.automation, name).toEqual([
          { call: 'linearRampToValueAtTime', value: after.get(name), time: 1 },
        ]);
      } else {
        expect(after.get(name), `${name} changed by set but not by the lane`).toBe(param.value);
      }
    }
  });

  it.each(cases)(
    '$kind $field: a knob edit skips the held params, then the release restores',
    (c) => {
      const spec = openSpec(c.kind);
      const lane = build(spec);
      const handle = lane.stage.param!(c.field)!;
      handle.hold(otherValue(c.row, fieldValue(spec, c.field)), 0);
      const held = values(lane);
      const owned = touched(lane);
      const edited = everyKnobMoved(spec);
      lane.stage.set(edited);
      const knob = build(spec);
      knob.stage.set(edited);
      const want = values(knob);
      let applied = 0;
      for (const [name, param] of lane.params) {
        if (owned.includes(name)) expect(param.value, name).toBe(held.get(name));
        else expect(param.value, name).toBe(want.get(name));
        if (!owned.includes(name) && want.get(name) !== held.get(name)) applied++;
      }
      expect(applied, 'some other knob applied').toBeGreaterThan(0);
      handle.release(2);
      for (const [name, param] of lane.params) expect(param.value, name).toBe(want.get(name));
    },
  );

  it('hands out the same handle for a field each time, and none for a non-field', () => {
    for (const kind of INSERT_KIND_NAMES) {
      const { stage } = build(openSpec(kind));
      const field = INSERT_AUTOMATION_FIELDS[kind][0]!.target;
      expect(stage.param!(field), kind).toBe(stage.param!(field));
      for (const junk of ['enabled', 'kind', 'bands.99.freq', 'stages.9.amount', 'nope']) {
        expect(stage.param!(junk), `${kind} ${junk}`).toBeUndefined();
      }
    }
  });
});

describe('two lanes on one param', () => {
  /** Kinds where two fields share a param, and the two fields. */
  const SHARED = [
    ['drive', 'drive', 'mix'],
    ['chorus', 'depth', 'spread'],
    ['ensemble', 'width', 'mix'],
  ] as const;

  it.each(SHARED)('%s: %s and %s write the shared param from each other', (kind, a, b) => {
    const spec = openSpec(kind);
    const rows = INSERT_AUTOMATION_FIELDS[kind] as readonly AutomationTargetRow[];
    const row = (field: string) => rows.find((r) => r.target === field)!;
    const va = otherValue(row(a), fieldValue(spec, a));
    const vb = otherValue(row(b), fieldValue(spec, b));
    const lane = build(spec);
    lane.stage.param!(a)!.hold(va, 0);
    lane.stage.param!(b)!.hold(vb, 0);
    const knob = build(spec);
    knob.stage.set(withField(withField(spec, a, va), b, vb));
    const want = values(knob);
    for (const name of touched(lane))
      expect(lane.params.get(name)!.value, name).toBe(want.get(name));
    // The other lane moves on: the shared param follows from the first lane's value.
    const vb2 = otherValue(row(b), vb, 0.9);
    lane.stage.param!(b)!.schedule(vb2, 1, 'ramp');
    knob.stage.set(withField(withField(spec, a, va), b, vb2));
    const next = values(knob);
    for (const name of touched(lane))
      expect(lane.params.get(name)!.value, name).toBe(next.get(name));
  });
});
