/** Audible output switches live without touching the post-FX detector signal. */
import { partAt } from '@windsor/engine';
import { type AppCtx, partChange } from './context';
import { el } from './dom';
export function trackOutput(ctx: AppCtx, slot: number): HTMLElement {
  const wrap = el('label', 'field-wrap', 'Output');
  const select = document.createElement('select');
  select.className = 'field';
  select.setAttribute('aria-label', `Output slot ${slot}`);
  select.add(new Option('Master', 'master'));
  select.add(new Option('Sidechain only', 'sidechain'));
  const selected = partAt(ctx.model.doc, slot)?.strip.output ?? 'master';
  select.value = selected;
  select.onchange = (): void => {
    const output = select.value === 'sidechain' ? 'sidechain' : 'master';
    if (!ctx.change(partChange(slot, { strip: { output } })).ok) select.value = selected;
  };
  wrap.appendChild(select);
  return wrap;
}
