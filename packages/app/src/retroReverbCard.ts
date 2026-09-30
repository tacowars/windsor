/**
 * The retro reverb's card, on one page (windsor#173): its preset and mode
 * pickers, then the knobs the mode uses in columns of two. Presets are
 * editable starting points: the song stores values, never a dependency on a
 * preset ID. The on/off switch is the rack's rail.
 */
import {
  DEFAULT_RETRO_REVERB,
  RETRO_REVERB_PRESETS,
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

function labelled(label: string, select: HTMLSelectElement): HTMLElement {
  const wrap = el('label', 'field-wrap', label);
  wrap.appendChild(select);
  return wrap;
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
    const preset = document.createElement('select');
    preset.className = 'field';
    preset.setAttribute('aria-label', 'Retro reverb preset');
    preset.add(new Option('Custom', ''));
    for (const entry of RETRO_REVERB_PRESETS)
      preset.add(new Option(entry.label, String(entry.number)));
    preset.value = String(matchingRetroPreset(current()) ?? '');
    preset.onchange = (): void => commit(applyRetroPreset(current(), Number(preset.value)));
    const mode = document.createElement('select');
    mode.className = 'field';
    mode.setAttribute('aria-label', 'Retro reverb mode');
    for (const value of RETRO_REVERB_MODES) mode.add(new Option(value, value));
    mode.value = current().mode;
    mode.onchange = (): void => {
      const value = RETRO_REVERB_MODES.find((entry) => entry === mode.value);
      if (value) commit({ ...current(), mode: value });
    };
    const knobs = RETRO_REVERB_KNOBS.filter(({ f }) =>
      current().mode === 'reverb' ? f !== 'duration' : f !== 'decay' && f !== 'size',
    );
    const page = insertPage(
      wideColumn(labelled('Preset approximation', preset), labelled('Mode', mode)),
      ...insertKnobs(ctx, slot, index, knobs, () => {
        preset.value = String(matchingRetroPreset(current()) ?? '');
      }),
    );
    page.classList.add('retro-reverb-card');
    return page;
  };
  return [{ name: 'Reverb', build }];
};
