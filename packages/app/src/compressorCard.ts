/**
 * The compressor's card: its controls commit the complete insert list into
 * the song. One page (windsor#173): the sidechain and the three stepped
 * pickers in two wide columns, the knobs in columns of two, Mix at the
 * rack's big dial, then the gain-reduction meter in a column of its own.
 * The on/off switch is the rack's rail.
 */
import { DEFAULT_COMPRESSOR } from '@windsor/engine';
import { sidechainSelector } from './sidechainSelector';
import { compressorMeter } from './compressorMeter';
import { COMPRESSOR_KNOBS, COMPRESSOR_SELECTS } from './compressorTables';
import { insertChange } from './insertTarget';
import type { InsertCard } from './insertCards';
import { setInsertField } from './insertEdits';
import { bigInsertKnobs, insertKnobs, insertsOf, pickKnobs } from './insertKnobs';
import { insertColumn, insertPage, insertSelect, wideColumn } from './insertLayout';
import type { AppCtx } from './context';
import type { InsertTarget } from './insertTarget';

type SteppedField = (typeof COMPRESSOR_SELECTS)[number]['field'];

function steppedPicker(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  field: SteppedField,
): HTMLElement {
  const spec = insertsOf(ctx, slot)[index];
  const current = spec?.kind === 'compressor' ? spec : DEFAULT_COMPRESSOR;
  const { label, values, format } = COMPRESSOR_SELECTS.find((entry) => entry.field === field)!;
  return insertSelect({
    label,
    options: values.map((value: number) => [String(value), format(value)] as const),
    value: String(current[field]),
    change: (value) => {
      const inserts = setInsertField(insertsOf(ctx, slot), index, field, Number(value));
      void ctx.change(insertChange(slot, inserts));
    },
  });
}

export const compressorCard: InsertCard = (ctx, slot, index) => [
  {
    name: 'Comp',
    build: () =>
      insertPage(
        wideColumn(sidechainSelector(ctx, slot, index), steppedPicker(ctx, slot, index, 'ratio')),
        wideColumn(
          steppedPicker(ctx, slot, index, 'attack'),
          steppedPicker(ctx, slot, index, 'release'),
        ),
        ...insertKnobs(
          ctx,
          slot,
          index,
          pickKnobs(COMPRESSOR_KNOBS, ['threshold', 'highpass', 'makeup', 'range']),
        ),
        ...bigInsertKnobs(ctx, slot, index, pickKnobs(COMPRESSOR_KNOBS, ['mix'])),
        insertColumn(compressorMeter(ctx, slot, index)),
      ),
  },
];
