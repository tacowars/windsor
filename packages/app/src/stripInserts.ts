/**
 * A strip's inserts on the Mixer tab (#641): each insert as a box with its
 * card's knobs and a Remove button, then an Add picker that is disabled once
 * the strip holds `MAX_INSERTS`. Adding and removing are live partials like
 * every other strip edit: the engine rebuilds that one strip's chain, and the
 * transport and every other part keep playing.
 */
import type { InsertKindName } from '../../../packages/client/src/audio/index-for-editor';
import {
  INSERT_KIND_NAMES,
  MAX_INSERTS,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el } from './dom';
import { INSERT_CARDS } from './insertCards';
import { addInsert, canAddInsert, removeInsert } from './insertEdits';
import { INSERT_LABELS } from './insertKnobTables';
import { insertsOf } from './insertKnobs';

const ADD_PROMPT = 'Add insert…';

function commit(ctx: AppCtx, slot: number, inserts: unknown): void {
  const result = ctx.change(partChange(slot, { strip: { inserts } }));
  if (result.ok) ctx.render();
}

function insertBox(ctx: AppCtx, slot: number, index: number, kind: InsertKindName): HTMLElement {
  const box = el('div', 'insert-box');
  const head = el('div', 'insert-head');
  head.appendChild(el('span', 'insert-name', `${index + 1} · ${INSERT_LABELS[kind]}`));
  const remove = el('button', 'btn', 'Remove') as HTMLButtonElement;
  remove.type = 'button';
  remove.onclick = (): void => commit(ctx, slot, removeInsert(insertsOf(ctx, slot), index));
  head.appendChild(remove);
  box.appendChild(head);
  box.appendChild(INSERT_CARDS[kind](ctx, slot, index));
  return box;
}

function addPicker(ctx: AppCtx, slot: number): HTMLElement {
  const picker = document.createElement('select');
  picker.className = 'field';
  picker.name = `add-insert-${slot}`;
  picker.setAttribute('aria-label', `Add an insert to slot ${slot}`);
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
export function stripInserts(ctx: AppCtx, slot: number): HTMLElement {
  const row = el('div', 'insert-row');
  insertsOf(ctx, slot).forEach((spec, index) =>
    row.appendChild(insertBox(ctx, slot, index, spec.kind)),
  );
  row.appendChild(addPicker(ctx, slot));
  return row;
}
