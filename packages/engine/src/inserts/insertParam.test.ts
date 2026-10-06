/**
 * Every insert kind's lane handles (windsor#345, record
 * `2026-10-01-song-automation-lanes` decisions 1 and 2), for every field the
 * catalog lists, checked against the stage's own `set`:
 *
 * - a ramp through `stage.param(field)` reaches exactly the params `set`
 *   would change for that field, with the values `set` would write, so a
 *   field `set` maps to several params moves all of them consistently;
 * - while the handle is engaged, a knob edit to every field applies to every
 *   other param and leaves the lane's params as the lane holds them, a
 *   param the field shares following the other fields' new knobs (windsor#628);
 * - the release writes the knob's value back, as `set` would have.
 *
 * The switch (`enabled`, windsor#628) is one of those fields on every kind:
 * its lane `set`s, never ramps, and turning it off writes what `set` writes
 * for a spec switched off, which a native kind reaches across its fade
 * (windsor#629).
 */
import { afterAll, describe, expect, it } from 'vitest';

import { installParamWorklet } from '../__fixtures__/insertParamRig';
import {
  build,
  fieldValue,
  openSpec,
  otherValue,
  touched,
  values,
  withField,
} from '../__fixtures__/insertStageRig';
import type { AutomationHow } from '../automation/automationHandles';
import { insertKindFields } from '../automation/automationInsertFields';
import { INSERT_AUTOMATION_FIELDS } from '../automation/automationInsertTables';
import type { AutomationTargetRow } from '../automation/automationLane';
import { INSERT_SWITCH_FADE_S } from './insertConstants';
import type { InsertSpec } from './insertRegistry';
import { INSERT_KIND_NAMES } from './insertRegistry';

const undo = installParamWorklet();
afterAll(undo);

/** `spec` with every catalog field of its kind moved to another value. */
function everyKnobMoved(spec: InsertSpec): InsertSpec {
  let next = spec;
  for (const row of INSERT_AUTOMATION_FIELDS[spec.kind]) {
    next = withField(next, row.target, otherValue(row, fieldValue(spec, row.target), 0.71));
  }
  return next;
}

const cases = INSERT_KIND_NAMES.flatMap((kind) =>
  insertKindFields(kind).map((row) => ({ kind, row, field: row.target })),
);

/** The lane's value away from `spec`'s, and `spec` at it: the open spec's switch goes off. */
function moved(spec: InsertSpec, row: AutomationTargetRow): { value: number; knob: InsertSpec } {
  if (row.scale === 'switch') return { value: 0, knob: { ...spec, enabled: false } };
  const value = otherValue(row, fieldValue(spec, row.target));
  return { value, knob: withField(spec, row.target, value) };
}

/** A switch lane sets; every other lane ramps. */
const howOf = (row: AutomationTargetRow): AutomationHow =>
  row.scale === 'switch' ? 'set' : 'ramp';
const CALL: Readonly<Record<AutomationHow, string>> = {
  set: 'setValueAtTime',
  ramp: 'linearRampToValueAtTime',
};

describe('stage.param, every kind and every catalog field', () => {
  it('covers all thirteen kinds, each with its switch', () => {
    expect(new Set(cases.map((c) => c.kind)).size).toBe(INSERT_KIND_NAMES.length);
    expect(cases.filter((c) => c.field === 'enabled')).toHaveLength(INSERT_KIND_NAMES.length);
  });

  it.each(cases)('$kind $field: a lane reaches the params set writes, with its values', (c) => {
    const spec = openSpec(c.kind);
    const { value, knob: edited } = moved(spec, c.row);
    const lane = build(spec);
    const knob = build(spec);
    lane.stage.param!(c.field)!.schedule(value, 1, howOf(c.row));
    knob.stage.set(edited);
    const after = values(knob);
    const ramped = touched(lane);
    expect(ramped.length).toBeGreaterThan(0);
    for (const [name, param] of lane.params) {
      if (ramped.includes(name) && c.row.scale === 'switch') {
        // A native kind's switch crosses its fade from 1; a worklet kind's sets at 1.
        const end = 1 + INSERT_SWITCH_FADE_S;
        expect(param.valueAt(end), name).toBe(after.get(name));
        for (const { time } of param.automation)
          expect(time! >= 1 && time! <= end, name).toBe(true);
      } else if (ramped.includes(name)) {
        expect(param.automation, name).toEqual([
          { call: CALL[howOf(c.row)], value: after.get(name), time: 1 },
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
      const value = moved(spec, c.row).value;
      handle.hold(value, 0);
      const held = values(lane);
      const owned = touched(lane);
      const edited = everyKnobMoved(spec);
      lane.stage.set(edited);
      const knob = build(spec);
      knob.stage.set(edited);
      const want = values(knob);
      // The same lane over the edited knobs: what a param the field shares now holds.
      const over = build(edited);
      over.stage.param!(c.field)!.hold(value, 0);
      const holds = values(over);
      let applied = 0;
      for (const [name, param] of lane.params) {
        if (owned.includes(name)) expect(param.value, name).toBe(holds.get(name));
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
      expect(stage.param!('enabled'), kind).toBe(stage.param!('enabled'));
      for (const junk of ['kind', 'bands.99.freq', 'stages.9.amount', 'nope']) {
        expect(stage.param!(junk), `${kind} ${junk}`).toBeUndefined();
      }
    }
  });
});
