/** Tape model and randomization write the same song-owned insert as its knobs. */
import {
  DEFAULT_TAPE,
  TAPE_TYPES,
  TAPE_LABELS,
  randomiseTape,
  TAPE_PRESETS,
  applyTapePreset,
  type TapeSpec,
} from '@windsor/engine';
import type { AppCtx } from './context';
import type { InsertCard } from './insertCards';
import type { InsertTarget } from './insertTarget';
import { el } from './dom';
import { insertsOf } from './insertKnobs';
import { insertChange } from './insertTarget';
import { tapeKnobs } from './tapeKnobs';
function tapeBody(ctx: AppCtx, target: InsertTarget, index: number): HTMLElement {
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
  const preset = document.createElement('select');
  preset.className = 'field';
  preset.setAttribute('aria-label', 'Tape starting point');
  preset.add(new Option('Starting point…', ''));
  for (const entry of TAPE_PRESETS) preset.add(new Option(entry.label, entry.id));
  preset.onchange = (): void => commit(applyTapePreset(current(), preset.value));
  row.append(label, toggle, random, preset);
  root.append(row, tapeKnobs(ctx, target, index));
  return root;
}

/** Today's controls as one page whose body scrolls inside the rack's height (windsor#173; windsor#175 pages it). */
export const tapeCard: InsertCard = (ctx, target, index) => [
  { name: 'Tape', build: () => tapeBody(ctx, target, index) },
];
