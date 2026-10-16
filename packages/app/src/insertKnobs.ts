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
 *
 * A part's insert knob can be driven by a MIDI CC mapping (windsor#785,
 * `knobCc.ts`): its tag, ring and right-click menu. A group's, a send bus's
 * and the master's knobs name no part, so their menu refuses learn.
 */
import type { InsertSpec } from '@windsor/engine';
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
import { insertCcTarget, type KnobCcAt, type KnobCcBinding, knobCcScope } from './knobCc';

/** The id a chain's insert stands under when it has none, to ask whether its field is mappable. */
const NO_INSERT_ID = 'unsaved';

/**
 * The CC binding of the knob over `field` of the insert at `index` in
 * `target`'s chain: its catalog target by the insert's stable id, on the
 * part a part's chain is, else on no part. None for a field no CC can move
 * (`insertCcTarget`, which never throws on a field the catalog leaves out).
 */
function insertFieldCc(
  ctx: AppCtx,
  target: InsertTarget,
  index: number,
  field: string,
): KnobCcBinding {
  const chain = childAddress(target)?.chain ?? target;
  const part = typeof chain === 'number' ? chain : null;
  let last: KnobCcAt | null = null;
  const at = (): KnobCcAt | null => {
    const scope = insertLaneScope(ctx, target, index);
    // A bus's or the master's default chain carries no ids; its menu only refuses learn.
    const insertId = scope.spec?.id ?? (part === null && scope.spec ? NO_INSERT_ID : undefined);
    if (insertId === undefined || !scope.spec) return null;
    // A field the kind's catalog rows leave out (Bloom's Octave) is no target: no tag, no menu.
    const id = insertCcTarget(scope.spec.kind, insertId, `${scope.fieldPrefix}${field}`);
    if (id === null) return (last = null);
    if (last?.target !== id) last = { part, target: id };
    return last;
  };
  return { scope: knobCcScope(ctx), at };
}

/**
 * The lock on the knob over `field` of the insert at `index` in `target`'s
 * chain, for a part's strip or a group's (windsor#616), a slot child's
 * included (its host's lane on `slot.<field>`, `insertLaneScope`); nothing
 * for a send bus or the master. Its CC binding comes with it (windsor#785).
 */
export function insertFieldLock(
  ctx: AppCtx,
  target: InsertTarget,
  index: number,
  field: string,
): Pick<KnobSpec, 'automation' | 'cc'> {
  const cc = insertFieldCc(ctx, target, index, field);
  const chain = childAddress(target)?.chain ?? target;
  if (typeof chain !== 'number' && !isGroupTarget(chain)) return { cc };
  return {
    automation: () => {
      const at = insertLaneScope(ctx, target, index);
      const tick = knobSongTick(ctx.model.doc, ctx.transport.position());
      return insertKnobAutomation(at.holder, at.spec, `${at.fieldPrefix}${field}`, tick);
    },
    cc,
  };
}

/** The chain with the insert at `index` turned to `v`: by the entry's codec, else its number at `f`. */
function turned<S>(
  chain: readonly InsertSpec[],
  index: number,
  { f, limit, codec }: InsertKnobEntry<S>,
  v: number,
): InsertSpec[] {
  const spec = chain[index] as S | undefined;
  if (codec) {
    return chain.map((s, i) => (i === index && spec ? (codec.write(spec, v) as InsertSpec) : s));
  }
  return setInsertField(chain, index, f, limit && spec ? limit(v, spec) : v);
}

function rackKnob<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  entry: InsertKnobEntry<S>,
  knob: { readonly onChange: (() => void) | undefined; readonly dial: 'rack' | 'rack-big' },
): HTMLElement {
  const { f, label, o, codec } = entry;
  return makeKnob({
    label,
    ...o,
    color: STRIP_COLOR,
    dial: knob.dial,
    ...insertFieldLock(ctx, slot, index, f),
    get: () => {
      const spec = insertsOf(ctx, slot)[index] as S | undefined;
      if (codec) return spec ? codec.read(spec) : o.def;
      const value = (spec as Record<string, unknown> | undefined)?.[f];
      return typeof value === 'number' ? value : o.def;
    },
    set: (v) => {
      const inserts = turned(insertsOf(ctx, slot), index, entry, v);
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
