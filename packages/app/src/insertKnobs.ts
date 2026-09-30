/**
 * One insert's knobs over the document (#641): each reads the insert at its
 * index in the chain, and each turn sends the chain's whole next insert
 * list, which the engine takes as a param write when the kinds match. The
 * rack stands them in columns of two at its small dial, or one to a column
 * at its big dial (windsor#173 decision 5; the mockup's `.knob.big`).
 */
import type { InsertTarget } from './insertTarget';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { insertChange, insertsOf } from './insertTarget';
export { insertsOf } from './insertTarget';
import { setInsertField } from './insertEdits';
import { insertColumn, knobColumns } from './insertLayout';
import type { InsertKnobEntry } from './insertKnobTables';
import { makeKnob } from './knob';

function rackKnob<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  { f, label, o }: InsertKnobEntry<S>,
  knob: { readonly onChange: (() => void) | undefined; readonly dial: 'rack' | 'rack-big' },
): HTMLElement {
  return makeKnob({
    label,
    ...o,
    color: STRIP_COLOR,
    dial: knob.dial,
    get: () => {
      const spec = insertsOf(ctx, slot)[index] as Record<string, unknown> | undefined;
      const value = spec?.[f];
      return typeof value === 'number' ? value : o.def;
    },
    set: (v) => {
      const inserts = setInsertField(insertsOf(ctx, slot), index, f, v);
      if (ctx.change(insertChange(slot, inserts)).ok) knob.onChange?.();
    },
  });
}

/** The knob for one field of the insert at `index`, at the rack's small dial. */
export function insertKnob<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  entry: InsertKnobEntry<S>,
  onChange?: () => void,
): HTMLElement {
  return rackKnob(ctx, slot, index, entry, { onChange, dial: 'rack' });
}

/** `entries`' knobs in columns of two, in order. */
export function insertKnobs<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  entries: readonly InsertKnobEntry<S>[],
  onChange?: () => void,
): HTMLElement[] {
  return knobColumns(entries.map((entry) => insertKnob(ctx, slot, index, entry, onChange)));
}

/** `entries`' knobs at the rack's big dial, one to a column, in order. */
export function bigInsertKnobs<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  entries: readonly InsertKnobEntry<S>[],
  onChange?: () => void,
): HTMLElement[] {
  return entries.map((entry) =>
    insertColumn(rackKnob(ctx, slot, index, entry, { onChange, dial: 'rack-big' })),
  );
}

/** The entries for `fields`, in the order `fields` names them. */
export function pickKnobs<S>(
  entries: readonly InsertKnobEntry<S>[],
  fields: readonly InsertKnobEntry<S>['f'][],
): InsertKnobEntry<S>[] {
  return fields.flatMap((field) => entries.filter((entry) => entry.f === field));
}
