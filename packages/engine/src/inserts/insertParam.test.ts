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
import { INSERT_AUTOMATION_FIELDS } from '../automation/automationInsertTables';
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
