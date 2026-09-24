/** Presets are editable starting points. The song stores values, never a dependency on a preset ID. */
import {
  DEFAULT_PHASER,
  PHASER_PRESETS,
  applyPhaserPreset,
  matchingPhaserPreset,
} from '../../../packages/client/src/audio/index-for-editor';
import { PHASER_KNOBS } from './phaserTables';
import { insertChange } from './insertTarget';
import { el } from './dom';
import type { InsertCard } from './insertCards';
import { insertKnobs, insertsOf } from './insertKnobs';

export const phaserCard: InsertCard = (ctx, slot, index) => {
  const root = el('div', 'phaser-card');
  const current = (): typeof DEFAULT_PHASER => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === 'phaser' ? spec : DEFAULT_PHASER;
  };
  const commit = (spec: typeof DEFAULT_PHASER): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== 'phaser') return;
    inserts[index] = spec;
    if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
  };
  const row = el('div', 'knob-row');
  const preset = document.createElement('select');
  preset.className = 'field';
  preset.setAttribute('aria-label', 'Phaser preset');
  preset.add(new Option('Custom', ''));
  for (const entry of PHASER_PRESETS) preset.add(new Option(entry.label, entry.id));
  preset.value = String(matchingPhaserPreset(current()) ?? '');
  preset.onchange = (): void => commit(applyPhaserPreset(current(), preset.value));
  const presetLabel = el('label', 'field-wrap', 'Starting point');
  presetLabel.appendChild(preset);
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = current().enabled;
  enabled.onchange = (): void => commit({ ...current(), enabled: enabled.checked });
  const enableLabel = el('label', 'field-wrap', 'Phaser');
  enableLabel.appendChild(enabled);
  row.append(presetLabel, enableLabel);
  root.append(
    row,
    insertKnobs(ctx, slot, index, PHASER_KNOBS, () => {
      preset.value = String(matchingPhaserPreset(current()) ?? '');
    }),
  );
  return root;
};
