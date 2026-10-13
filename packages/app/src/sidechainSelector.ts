/** Track names are labels only: the song stores stable slots. */
import { canSidechain, isKeyedSpec, withSidechain } from '@windsor/engine';
import type { SidechainSource } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { insertNote } from './insertLayout';
import {
  insertsOf,
  isBusTarget,
  isChildTarget,
  isGroupTarget,
  targetChange,
  type ChainTarget,
  type InsertTarget,
} from './insertTarget';
/** A keyed insert's source (the compressor's, the Pump's); a slot child's is always Internal and has none (windsor#692). */
export function sidechainSelector(ctx: AppCtx, target: ChainTarget, index: number): HTMLElement {
  const wrap = el('label', 'field-wrap', 'Sidechain (post-FX)');
  const select = document.createElement('select');
  select.className = 'field';
  select.setAttribute('aria-label', `Sidechain ${target} insert ${index + 1}`);
  select.add(new Option('Internal', 'internal'));
  const spec = insertsOf(ctx, target)[index];
  const source = isKeyedSpec(spec) ? spec.sidechain : undefined;
  const selected =
    typeof source === 'object'
      ? source.track === null
        ? 'disconnected'
        : String(source.track)
      : 'internal';
  if (selected === 'disconnected')
    select.add(new Option('Disconnected (external)', 'disconnected'));
  // A send bus keys from its own input (windsor#172), and so does a group
  // (record `2026-10-01-group-buses` §8): no part is offered.
  if (!isBusTarget(target) && !isGroupTarget(target)) {
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
      at === index ? withSidechain(entry, sidechain) : entry,
    );
    if (ctx.change(targetChange(ctx, target, inserts)).ok) ctx.render();
    else select.value = selected;
  };
  wrap.appendChild(select);
  return wrap;
}

/** What a slot child's card says in place of its sidechain selector. */
export const CHILD_SIDECHAIN_NOTE = 'In the slot its sidechain is forced to Internal.';

/**
 * The sidechain selector, or in a host's slot the note that the source is
 * Internal (record `2026-10-11-wet-path-slot` decision 8).
 */
export const sidechainCell = (ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement =>
  isChildTarget(slot)
    ? insertNote(CHILD_SIDECHAIN_NOTE)
    : sidechainSelector(ctx, slot as ChainTarget, index);
