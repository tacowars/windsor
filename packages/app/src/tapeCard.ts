/** Tape model and randomization write the same song-owned insert as its knobs. */
import {
  DEFAULT_TAPE,
  TAPE_TYPES,
  TAPE_LABELS,
  randomiseTape,
  type TapeSpec,
} from '@windsor/engine';
import type { InsertCard } from './insertCards';
import { el } from './dom';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertChange } from './insertTarget';
import { TAPE_KNOBS } from './tapeTables';
export const tapeCard: InsertCard = (ctx, target, index) => {
  const root = el('div', 'tape-card');
  const current = (): TapeSpec => {
    const spec = insertsOf(ctx, target)[index];
    return spec?.kind === 'tape' ? spec : DEFAULT_TAPE;
  };
  const commit = (spec: TapeSpec): void => {
    const inserts = [...insertsOf(ctx, target)];
    if (inserts[index]?.kind !== 'tape') return;
    inserts[index] = spec;
    if (ctx.change(insertChange(target, inserts)).ok) ctx.render();
  };
  const row = el('div', 'knob-row');
  const model = document.createElement('select');
  model.className = 'field';
  model.setAttribute('aria-label', 'Tape type');
  TAPE_TYPES.forEach((value, i) => model.add(new Option(TAPE_LABELS[i], value)));
  model.value = current().model;
  model.onchange = (): void => commit({ ...current(), model: model.value as TapeSpec['model'] });
  const label = el('label', 'field-wrap', 'Tape type');
  label.append(model);
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = current().enabled;
  enabled.onchange = (): void => commit({ ...current(), enabled: enabled.checked });
  const toggle = el('label', 'field-wrap', 'Tape');
  toggle.append(enabled);
  const random = el('button', 'btn', 'Randomize');
  random.title = 'Roll a new tape character; keep Trim, Mix and bypass';
  random.onclick = (): void => commit(randomiseTape(current()));
  row.append(label, toggle, random);
  root.append(row, insertKnobs(ctx, target, index, TAPE_KNOBS));
  return root;
};
