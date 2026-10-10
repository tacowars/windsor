/**
 * The retro reverb's card (windsor#173): its preset, mode and converter pickers
 * (the converter in every mode, RV-6), then the knobs the mode uses in columns
 * of two. In reverb mode a second page, Space,
 * holds the tank's extra knobs: the table's entries marked `page: 'space'`
 * (`retroReverbTables.ts`). Presets are editable starting points: the song
 * stores values, never a dependency on a preset ID. The on/off switch is the
 * rack's rail.
 */
import {
  DEFAULT_RETRO_REVERB,
  RETRO_REVERB_PRESETS,
  RETRO_REVERB_CONVERTERS,
  RETRO_REVERB_MODES,
  applyRetroPreset,
  matchingRetroPreset,
} from '@windsor/engine';
import { RETRO_REVERB_KNOBS } from './retroReverbTables';
import { insertChange } from './insertTarget';
import { el } from './dom';
import type { InsertCard } from './insertCards';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertPage, wideColumn } from './insertLayout';

type RetroSpec = typeof DEFAULT_RETRO_REVERB;

/** The converter picker's labels: today's fixed quantiser, or the gain-ranging one. */
const CONVERTER_LABELS: Record<(typeof RETRO_REVERB_CONVERTERS)[number], string> = {
  linear: 'Linear',
  ranging: 'Gain-ranging',
};

function labelled(label: string, select: HTMLSelectElement): HTMLElement {
  const wrap = el('label', 'field-wrap', label);
  wrap.appendChild(select);
  return wrap;
}

/** A picker over one of the spec's string fields: its values, their labels, and the pick. */
function choice<T extends string>(
  aria: string,
  values: readonly T[],
  value: T,
  label: (entry: T) => string,
  pick: (entry: T) => void,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'field';
  select.setAttribute('aria-label', aria);
  for (const entry of values) select.add(new Option(label(entry), entry));
  select.value = value;
  select.onchange = (): void => {
    const entry = values.find((candidate) => candidate === select.value);
    if (entry) pick(entry);
  };
  return select;
}

/** The preset picker: Custom, then the bank; a pick writes the preset's whole state. */
function presetChoice(
  current: () => RetroSpec,
  commit: (spec: RetroSpec) => void,
): HTMLSelectElement {
  const preset = document.createElement('select');
  preset.className = 'field';
  preset.setAttribute('aria-label', 'Retro reverb preset');
  preset.add(new Option('Custom', ''));
  for (const entry of RETRO_REVERB_PRESETS)
    preset.add(new Option(entry.label, String(entry.number)));
  preset.value = String(matchingRetroPreset(current()) ?? '');
  preset.onchange = (): void => commit(applyRetroPreset(current(), Number(preset.value)));
  return preset;
}

export const retroReverbCard: InsertCard = (ctx, slot, index) => {
  const current = (): RetroSpec => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'retro-reverb' ? spec : DEFAULT_RETRO_REVERB;
  };
  const commit = (spec: RetroSpec): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'retro-reverb') return;
    inserts[index] = spec;
    if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
  };
  const build = (): HTMLElement => {
    const preset = presetChoice(current, commit);
    const mode = choice(
      'Retro reverb mode',
      RETRO_REVERB_MODES,
      current().mode,
      (value) => value,
      (value) => commit({ ...current(), mode: value }),
    );
    const converter = choice(
      'Retro reverb converter',
      RETRO_REVERB_CONVERTERS,
      current().converter,
      (value) => CONVERTER_LABELS[value],
      (value) => commit({ ...current(), converter: value }),
    );
    const knobs = RETRO_REVERB_KNOBS.filter(
      ({ f, page }) =>
        !page && (current().mode === 'reverb' ? f !== 'duration' : f !== 'decay' && f !== 'size'),
    );
    const page = insertPage(
      wideColumn(
        labelled('Preset approximation', preset),
        labelled('Mode', mode),
        labelled('Converter', converter),
      ),
      ...insertKnobs(ctx, slot, index, knobs, () => {
        preset.value = String(matchingRetroPreset(current()) ?? '');
      }),
    );
    page.classList.add('retro-reverb-card');
    return page;
  };
  const space = (): HTMLElement =>
    insertPage(
      ...insertKnobs(
        ctx,
        slot,
        index,
        RETRO_REVERB_KNOBS.filter(({ page }) => page === 'space'),
      ),
    );
  return current().mode === 'reverb'
    ? [
        { name: 'Reverb', build },
        { name: 'Space', build: space },
      ]
    : [{ name: 'Reverb', build }];
};
