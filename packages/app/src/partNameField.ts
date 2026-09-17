/**
 * A part's name field (#598): the one editable label, shown in the Parts tab
 * and on the part's Mixer strip. Committed on change (Enter or blur) as a live
 * partial on the part's slot; the name is never a key, so a rename touches no
 * strip, patch, capture or note stream.
 */
import { partAt } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';

export function partNameField(ctx: AppCtx, slot: number): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'field';
  input.name = `part-name-${slot}`;
  input.value = partAt(ctx.model.doc, slot)?.name ?? '';
  input.setAttribute('aria-label', `Name of the part on slot ${slot}`);
  input.onchange = (): void => {
    const name = input.value.trim();
    if (name === '' || name === partAt(ctx.model.doc, slot)?.name) {
      input.value = partAt(ctx.model.doc, slot)?.name ?? '';
      return;
    }
    if (ctx.change(partChange(slot, { name })).ok) ctx.render();
  };
  return input;
}
