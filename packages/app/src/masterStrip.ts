/**
 * The master's insert rack on the Mixer tab (#666, windsor#194 decision 1):
 * the document's `master.inserts`, at the top of the left column. The Level
 * fader, the meters and the output stage after it are the master column's
 * (`masterColumn.ts`).
 */
import type { AppCtx } from './context';
import { section } from './dom';
import { stripInserts } from './stripInserts';

export function renderMasterInserts(ctx: AppCtx): HTMLElement {
  const view = section('Master inserts', 'Parts and sends → inserts → the master column.');
  view.root.classList.add('master-strip');
  view.body.appendChild(stripInserts(ctx, 'master'));
  return view.root;
}
