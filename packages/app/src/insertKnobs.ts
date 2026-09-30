/**
 * One insert's knobs over the document (#641): each reads the insert at its
 * index in the chain, and each turn sends the chain's whole next insert
 * list, which the engine takes as a param write when the kinds match. The
 * rack stands them in columns of two (windsor#173 decision 5).
 */
import type { InsertTarget } from './insertTarget';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { insertChange, insertsOf } from './insertTarget';
export { insertsOf } from './insertTarget';
import { setInsertField } from './insertEdits';
import { insertColumn } from './insertLayout';
import type { InsertKnobEntry } from './insertKnobTables';
import { makeKnob } from './knob';

/** Knobs to a column in the rack. */
const KNOBS_PER_COLUMN = 2;

/** The knob for one field of the insert at `index`. */
export function insertKnob<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  { f, label, o }: InsertKnobEntry<S>,
  onChange?: () => void,
): HTMLElement {
  return makeKnob({
    label,
    ...o,
    color: STRIP_COLOR,
    get: () => {
      const spec = insertsOf(ctx, slot)[index] as Record<string, unknown> | undefined;
      const value = spec?.[f];
      return typeof value === 'number' ? value : o.def;
    },
    set: (v) => {
      const inserts = setInsertField(insertsOf(ctx, slot), index, f, v);
      if (ctx.change(insertChange(slot, inserts)).ok) onChange?.();
    },
  });
}

/** `entries`' knobs in columns of two, in order. */
export function insertKnobs<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  entries: readonly InsertKnobEntry<S>[],
  onChange?: () => void,
): HTMLElement[] {
  const columns: HTMLElement[] = [];
  for (let at = 0; at < entries.length; at += KNOBS_PER_COLUMN) {
    const knobs = entries
      .slice(at, at + KNOBS_PER_COLUMN)
      .map((entry) => insertKnob(ctx, slot, index, entry, onChange));
    columns.push(insertColumn(...knobs));
  }
  return columns;
}

/** The entries for `fields`, in the order `fields` names them. */
export function pickKnobs<S>(
  entries: readonly InsertKnobEntry<S>[],
  fields: readonly InsertKnobEntry<S>['f'][],
): InsertKnobEntry<S>[] {
  return fields.flatMap((field) => entries.filter((entry) => entry.f === field));
}
