/**
 * One insert's knobs over the document (#641): each reads the insert at its
 * index in the part's strip, and each turn sends the strip's whole next
 * insert list, which the engine takes as a param write when the kinds match.
 */
import type { InsertSpec } from '../../../packages/client/src/audio/index-for-editor';
import { partAt } from '../../../packages/client/src/audio/index-for-editor';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el } from './dom';
import { setInsertField } from './insertEdits';
import type { InsertKnobEntry } from './insertKnobTables';
import { makeKnob } from './knob';

/** The part's insert list as the document holds it now. */
export const insertsOf = (ctx: AppCtx, slot: number): readonly InsertSpec[] =>
  partAt(ctx.model.doc, slot)?.strip.inserts ?? [];

export function insertKnobs<S>(
  ctx: AppCtx,
  slot: number,
  index: number,
  entries: readonly InsertKnobEntry<S>[],
): HTMLElement {
  const row = el('div', 'knob-row');
  for (const { f, label, o } of entries) {
    row.appendChild(
      makeKnob({
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
          void ctx.change(partChange(slot, { strip: { inserts } }));
        },
      }),
    );
  }
  return row;
}
