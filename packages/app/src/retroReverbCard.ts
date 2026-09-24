/** Presets are editable starting points. The song stores values, never a dependency on a preset ID. */
import {
  DEFAULT_RETRO_REVERB,
  RETRO_REVERB_PRESETS,
  RETRO_REVERB_MODES,
  applyRetroPreset,
  matchingRetroPreset,
} from '../../../packages/client/src/audio/index-for-editor';
import { RETRO_REVERB_KNOBS } from './retroReverbTables';
import { insertChange } from './insertTarget';
import { el } from './dom';
import type { InsertCard } from './insertCards';
import { insertKnobs, insertsOf } from './insertKnobs';

export const retroReverbCard: InsertCard = (ctx, slot, index) => {
  const root = el('div', 'retro-reverb-card');
  const current = (): typeof DEFAULT_RETRO_REVERB => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'retro-reverb' ? spec : DEFAULT_RETRO_REVERB;
  };
  const commit = (spec: typeof DEFAULT_RETRO_REVERB): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'retro-reverb') return;
    inserts[index] = spec;
    if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
  };
  const row = el('div', 'knob-row');
  const preset = document.createElement('select');
  preset.className = 'field';
  preset.setAttribute('aria-label', 'Retro reverb preset');
  preset.add(new Option('Custom', ''));
  for (const entry of RETRO_REVERB_PRESETS)
    preset.add(new Option(entry.label, String(entry.number)));
  preset.value = String(matchingRetroPreset(current()) ?? '');
  preset.onchange = (): void => commit(applyRetroPreset(current(), Number(preset.value)));
  const presetLabel = el('label', 'field-wrap', 'Preset approximation');
  presetLabel.appendChild(preset);
  const mode = document.createElement('select');
  mode.className = 'field';
  mode.setAttribute('aria-label', 'Retro reverb mode');
  for (const value of RETRO_REVERB_MODES) mode.add(new Option(value, value));
  mode.value = current().mode;
  mode.onchange = (): void => {
    const value = RETRO_REVERB_MODES.find((entry) => entry === mode.value);
    if (value) commit({ ...current(), mode: value });
  };
  const modeLabel = el('label', 'field-wrap', 'Mode');
  modeLabel.appendChild(mode);
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = current().enabled;
  enabled.onchange = (): void => commit({ ...current(), enabled: enabled.checked });
  const enableLabel = el('label', 'field-wrap', 'Reverb');
  enableLabel.appendChild(enabled);
  row.append(presetLabel, modeLabel, enableLabel);
  const knobs = RETRO_REVERB_KNOBS.filter(({ f }) =>
    current().mode === 'reverb' ? f !== 'duration' : f !== 'decay' && f !== 'size',
  );
  root.append(
    row,
    insertKnobs(ctx, slot, index, knobs, () => {
      preset.value = String(matchingRetroPreset(current()) ?? '');
    }),
  );
  return root;
};
