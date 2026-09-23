/** The compressor's controls commit the complete insert list into the song. */
import { DEFAULT_COMPRESSOR } from '../../../packages/client/src/audio/index-for-editor';
import { sidechainSelector } from './sidechainSelector';
import { compressorMeter } from './compressorMeter';
import { COMPRESSOR_KNOBS, COMPRESSOR_SELECTS } from './compressorTables';
import { insertChange } from './insertTarget';
import { el } from './dom';
import type { InsertCard } from './insertCards';
import { setInsertField } from './insertEdits';
import { insertKnobs, insertsOf } from './insertKnobs';

export const compressorCard: InsertCard = (ctx, slot, index) => {
  const root = el('div', 'compressor-card');
  const spec = insertsOf(ctx, slot)[index];
  const current = spec?.kind === 'compressor' ? spec : DEFAULT_COMPRESSOR;
  const commit = (field: string, value: number | boolean): void => {
    const inserts = setInsertField(insertsOf(ctx, slot), index, field, value);
    void ctx.change(insertChange(slot, inserts));
  };
  const switches = el('div', 'knob-row');
  for (const { field, label, values, format } of COMPRESSOR_SELECTS) {
    const wrap = el('label', 'field-wrap', label);
    const select = document.createElement('select');
    select.className = 'field';
    select.setAttribute('aria-label', label);
    for (const value of values) select.add(new Option(format(value), String(value)));
    select.value = String(current[field]);
    select.onchange = (): void => commit(field, Number(select.value));
    wrap.appendChild(select);
    switches.appendChild(wrap);
  }
  const bypass = el('label', 'field-wrap', 'Compression');
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = current.enabled;
  enabled.onchange = (): void => commit('enabled', enabled.checked);
  bypass.appendChild(enabled);
  switches.appendChild(bypass);
  root.append(
    switches,
    sidechainSelector(ctx, slot, index),
    insertKnobs(ctx, slot, index, COMPRESSOR_KNOBS),
    compressorMeter(ctx, slot, index),
  );
  return root;
};
