/**
 * The compressor's card: its controls commit the complete insert list into
 * the song. One page (windsor#173): the sidechain and the three stepped
 * pickers in a wide column, the knobs in columns of two, then the
 * gain-reduction meter in a column of its own. The on/off switch is the
 * rack's rail.
 */
import { DEFAULT_COMPRESSOR } from '@windsor/engine';
import { sidechainSelector } from './sidechainSelector';
import { compressorMeter } from './compressorMeter';
import { COMPRESSOR_KNOBS, COMPRESSOR_SELECTS } from './compressorTables';
import { insertChange } from './insertTarget';
import { el } from './dom';
import type { InsertCard } from './insertCards';
import { setInsertField } from './insertEdits';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertColumn, insertPage, wideColumn } from './insertLayout';
import type { AppCtx } from './context';
import type { InsertTarget } from './insertTarget';

function steppedPickers(ctx: AppCtx, slot: InsertTarget, index: number): HTMLElement[] {
  const spec = insertsOf(ctx, slot)[index];
  const current = spec?.kind === 'compressor' ? spec : DEFAULT_COMPRESSOR;
  return COMPRESSOR_SELECTS.map(({ field, label, values, format }) => {
    const wrap = el('label', 'field-wrap', label);
    const select = document.createElement('select');
    select.className = 'field';
    select.setAttribute('aria-label', label);
    for (const value of values) select.add(new Option(format(value), String(value)));
    select.value = String(current[field]);
    select.onchange = (): void => {
      const inserts = setInsertField(insertsOf(ctx, slot), index, field, Number(select.value));
      void ctx.change(insertChange(slot, inserts));
    };
    wrap.appendChild(select);
    return wrap;
  });
}

export const compressorCard: InsertCard = (ctx, slot, index) => [
  {
    name: 'Comp',
    build: () =>
      insertPage(
        wideColumn(sidechainSelector(ctx, slot, index), ...steppedPickers(ctx, slot, index)),
        ...insertKnobs(ctx, slot, index, COMPRESSOR_KNOBS),
        insertColumn(compressorMeter(ctx, slot, index)),
      ),
  },
];
