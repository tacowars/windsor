/** Track names are labels only: the song stores stable slots. */
import { canSidechain } from '@windsor/engine';
import type { SidechainSource } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { insertChange, insertsOf, isBusTarget, type InsertTarget } from './insertTarget';
export function sidechainSelector(ctx: AppCtx, target: InsertTarget, index: number): HTMLElement {
  const wrap = el('label', 'field-wrap', 'Sidechain (post-FX)');
  const select = document.createElement('select');
  select.className = 'field';
  select.setAttribute('aria-label', `Sidechain ${target} insert ${index + 1}`);
  select.add(new Option('Internal', 'internal'));
  const spec = insertsOf(ctx, target)[index];
  const source = spec?.kind === 'compressor' ? spec.sidechain : undefined;
  const selected =
    typeof source === 'object'
      ? source.track === null
        ? 'disconnected'
        : String(source.track)
      : 'internal';
  if (selected === 'disconnected')
    select.add(new Option('Disconnected (external)', 'disconnected'));
  // A send bus keys from its own input (windsor#172): no part is offered.
  if (!isBusTarget(target)) {
    for (const part of ctx.model.doc.parts) {
      const option = new Option(`${part.name} (slot ${part.slot})`, String(part.slot));
      option.disabled = !canSidechain(ctx.model.doc, target, index, part.slot);
      select.add(option);
    }
  }
  select.value = selected;
  select.onchange = (): void => {
    const sidechain: SidechainSource =
      select.value === 'internal'
        ? 'internal'
        : { track: select.value === 'disconnected' ? null : Number(select.value) };
    const inserts = insertsOf(ctx, target).map((entry, at) =>
      at === index && entry.kind === 'compressor' ? { ...entry, sidechain } : entry,
    );
    if (ctx.change(insertChange(target, inserts)).ok) ctx.render();
    else select.value = selected;
  };
  wrap.appendChild(select);
  return wrap;
}
