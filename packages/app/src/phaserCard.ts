/**
 * The phaser's card, on one page (windsor#173): its Starting point picker,
 * then its knobs in columns of two. Presets are editable starting points:
 * the song stores values, never a dependency on a preset ID. The on/off
 * switch is the rack's rail.
 */
import {
  DEFAULT_PHASER,
  PHASER_PRESETS,
  applyPhaserPreset,
  matchingPhaserPreset,
} from '@windsor/engine';
import { PHASER_KNOBS } from './phaserTables';
import { insertChange } from './insertTarget';
import { el } from './dom';
import type { InsertCard } from './insertCards';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertPage, wideColumn } from './insertLayout';

export const phaserCard: InsertCard = (ctx, slot, index) => {
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
  const build = (): HTMLElement => {
    const preset = document.createElement('select');
    preset.className = 'field';
    preset.setAttribute('aria-label', 'Phaser preset');
    preset.add(new Option('Custom', ''));
    for (const entry of PHASER_PRESETS) preset.add(new Option(entry.label, entry.id));
    preset.value = String(matchingPhaserPreset(current()) ?? '');
    preset.onchange = (): void => commit(applyPhaserPreset(current(), preset.value));
    const presetLabel = el('label', 'field-wrap', 'Starting point');
    presetLabel.appendChild(preset);
    return insertPage(
      wideColumn(presetLabel),
      ...insertKnobs(ctx, slot, index, PHASER_KNOBS, () => {
        preset.value = String(matchingPhaserPreset(current()) ?? '');
      }),
    );
  };
  return [{ name: 'Phaser', build }];
};
