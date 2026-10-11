/**
 * One insert's knobs over the document (#641): each reads the insert at its
 * index in the chain, and each turn sends the chain's whole next insert
 * list, which the engine takes as a param write when the kinds match. The
 * rack stands them in columns of two at its small dial, or one to a column
 * at its big dial (windsor#173 decision 5; the mockup's `.knob.big`).
 *
 * On a part's strip, and on a group's (windsor#616), a knob is locked while
 * a lane on its field is on (windsor#351, `knobAutomation.ts`). A lane on a
 * field the insert's settings leave unread is inert and locks nothing; the
 * send buses and the master carry no lanes. A host's slot child
 * (windsor#692) locks under its host's lane on `slot.<field>`.
 */
import type { InsertTarget } from './insertTarget';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import {
  childAddress,
  insertLaneScope,
  insertsOf,
  isGroupTarget,
  targetChange,
} from './insertTarget';
export { insertsOf } from './insertTarget';
import { setInsertField } from './insertEdits';
import { insertColumn, knobColumns } from './insertLayout';
import type { InsertKnobEntry } from './insertKnobTables';
import { makeKnob, type KnobSpec } from './knob';
import { insertKnobAutomation, knobSongTick } from './knobAutomation';

/**
 * The lock on the knob over `field` of the insert at `index` in `target`'s
 * chain, for a part's strip or a group's (windsor#616), a slot child's
 * included (its host's lane on `slot.<field>`, `insertLaneScope`); nothing
 * for a send bus or the master.
 */
export function insertFieldLock(
  ctx: AppCtx,
  target: InsertTarget,
  index: number,
  field: string,
): Pick<KnobSpec, 'automation'> {
  const chain = childAddress(target)?.chain ?? target;
  if (typeof chain !== 'number' && !isGroupTarget(chain)) return {};
  return {
    automation: () => {
      const at = insertLaneScope(ctx, target, index);
      const tick = knobSongTick(ctx.model.doc, ctx.transport.position());
      return insertKnobAutomation(at.holder, at.spec, `${at.fieldPrefix}${field}`, tick);
    },
  };
}

function rackKnob<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  { f, label, o, limit }: InsertKnobEntry<S>,
  knob: { readonly onChange: (() => void) | undefined; readonly dial: 'rack' | 'rack-big' },
): HTMLElement {
  const stop = (v: number): number => {
    const spec = insertsOf(ctx, slot)[index] as S | undefined;
    return limit && spec ? limit(v, spec) : v;
  };
  return makeKnob({
    label,
    ...o,
    color: STRIP_COLOR,
    dial: knob.dial,
    ...insertFieldLock(ctx, slot, index, f),
    get: () => {
      const spec = insertsOf(ctx, slot)[index] as Record<string, unknown> | undefined;
      const value = spec?.[f];
      return typeof value === 'number' ? value : o.def;
    },
    set: (v) => {
      const inserts = setInsertField(insertsOf(ctx, slot), index, f, stop(v));
      if (ctx.change(targetChange(ctx, slot, inserts)).ok) knob.onChange?.();
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
