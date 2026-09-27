/**
 * A strip's inserts on the Mixer tab (#641): each insert as a box with its
 * card's knobs, arrows that nudge it along the chain (#652) and a Remove
 * button, then an Add picker that is disabled once the strip holds
 * `MAX_INSERTS`. The boxes read left to right in signal order. Adding and removing are live partials like
 * every other strip edit: the engine rebuilds that one strip's chain, and the
 * transport and every other part keep playing.
 */
import type { InsertTarget } from './insertTarget';
import type { InsertKindName, InsertSpec } from '@windsor/engine';
import { INSERT_KIND_NAMES, MAX_INSERTS } from '@windsor/engine';
import type { AppCtx } from './context';
import { insertChange } from './insertTarget';
import { el } from './dom';
import { INSERT_CARDS } from './insertCards';
import { addInsert, canAddInsert, moveInsert, removeInsert } from './insertEdits';
import { INSERT_LABELS } from './insertKnobTables';
import { insertsOf } from './insertKnobs';

const ADD_PROMPT = 'Add insert…';

function commit(ctx: AppCtx, slot: InsertTarget, inserts: readonly InsertSpec[]): void {
  const result = ctx.change(insertChange(slot, inserts));
  if (result.ok) ctx.render();
}

/** One nudge along the chain: ◀ towards the front, ▶ towards the back (#652). */
function moveButton(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  delta: number,
): HTMLButtonElement {
  const back = delta < 0;
  const button = el('button', 'btn nudge', back ? '◀' : '▶') as HTMLButtonElement;
  button.type = 'button';
  const list = insertsOf(ctx, slot);
  const kind = list[index]?.kind;
  button.title = `Move ${kind ? INSERT_LABELS[kind] : 'this insert'} ${back ? 'earlier' : 'later'} in the chain`;
  button.setAttribute('aria-label', button.title);
  button.disabled = back ? index === 0 : index === list.length - 1;
  button.onclick = (): void => commit(ctx, slot, moveInsert(insertsOf(ctx, slot), index, delta));
  return button;
}

function insertBox(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  kind: InsertKindName,
): HTMLElement {
  const box = el('div', 'insert-box');
  const head = el('div', 'insert-head');
  head.appendChild(moveButton(ctx, slot, index, -1));
  head.appendChild(el('span', 'insert-name', `${index + 1} · ${INSERT_LABELS[kind]}`));
  head.appendChild(moveButton(ctx, slot, index, 1));
  const remove = el('button', 'btn', 'Remove') as HTMLButtonElement;
  remove.type = 'button';
  remove.onclick = (): void => commit(ctx, slot, removeInsert(insertsOf(ctx, slot), index));
  head.appendChild(remove);
  box.appendChild(head);
  box.appendChild(INSERT_CARDS[kind](ctx, slot, index));
  return box;
}

function addPicker(ctx: AppCtx, slot: InsertTarget): HTMLElement {
  const picker = document.createElement('select');
  picker.className = 'field';
  picker.name = `add-insert-${slot}`;
  picker.setAttribute(
    'aria-label',
    slot === 'master' ? 'Add an insert to Master' : `Add an insert to slot ${slot}`,
  );
  picker.add(new Option(ADD_PROMPT, ''));
  for (const kind of INSERT_KIND_NAMES) picker.add(new Option(INSERT_LABELS[kind], kind));
  const full = !canAddInsert(insertsOf(ctx, slot));
  picker.disabled = full;
  picker.title = full ? `A strip holds at most ${MAX_INSERTS} inserts` : '';
  picker.onchange = (): void => {
    const kind = picker.value as InsertKindName | '';
    picker.value = '';
    if (kind !== '') commit(ctx, slot, addInsert(insertsOf(ctx, slot), kind));
  };
  return picker;
}

/** The inserts row under a strip's knobs. */
export function stripInserts(ctx: AppCtx, slot: InsertTarget): HTMLElement {
  const row = el('div', 'insert-row');
  insertsOf(ctx, slot).forEach((spec, index) =>
    row.appendChild(insertBox(ctx, slot, index, spec.kind)),
  );
  row.appendChild(addPicker(ctx, slot));
  return row;
}
