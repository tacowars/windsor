/**
 * One insert's knobs over the document (#641): each reads the insert at its
 * index in the part's strip, and each turn sends the strip's whole next
 * insert list, which the engine takes as a param write when the kinds match.
 */
import type { InsertTarget } from './insertTarget';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { insertChange, insertsOf } from './insertTarget';
export { insertsOf } from './insertTarget';
import { el } from './dom';
import { setInsertField } from './insertEdits';
import type { InsertKnobEntry } from './insertKnobTables';
import { makeKnob } from './knob';

export function insertKnobs<S>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  entries: readonly InsertKnobEntry<S>[],
  onChange?: () => void,
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
          if (ctx.change(insertChange(slot, inserts)).ok) onChange?.();
        },
      }),
    );
  }
  return row;
}
