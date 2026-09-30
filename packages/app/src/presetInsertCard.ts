/**
 * An insert card with a preset picker beside its knobs (#695; the phaser's
 * card is the shape), on one page (windsor#173). Presets are editable
 * starting points: the song stores values, never a preset id, and any knob
 * turn that leaves every preset's values reads Custom. The on/off switch is
 * the rack's rail.
 */
import type { InsertSpec } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import type { InsertPage } from './insertCards';
import type { InsertKnobEntry } from './insertKnobTables';
import { insertKnobs, insertsOf } from './insertKnobs';
import { insertPage, wideColumn } from './insertLayout';
import type { InsertTarget } from './insertTarget';
import { insertChange } from './insertTarget';

type Switchable = Extract<InsertSpec, { readonly enabled: boolean }>;

export interface PresetCardSpec<S extends Switchable> {
  readonly kind: S['kind'];
  /** What the page and the picker are called. */
  readonly label: string;
  readonly defaults: S;
  readonly presets: readonly { readonly id: string; readonly label: string }[];
  apply(spec: S, id: string): S;
  match(spec: S): string | undefined;
  readonly knobs: readonly InsertKnobEntry<S>[];
}

function presetPage<S extends Switchable>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  card: PresetCardSpec<S>,
): HTMLElement {
  const current = (): S => {
    const spec = insertsOf(ctx, slot)[index];
    return spec?.kind === card.kind ? (spec as S) : card.defaults;
  };
  const commit = (spec: S): void => {
    const inserts = [...insertsOf(ctx, slot)];
    if (inserts[index]?.kind !== card.kind) return;
    inserts[index] = spec;
    if (ctx.change(insertChange(slot, inserts)).ok) ctx.render();
  };
  const preset = document.createElement('select');
  preset.className = 'field';
  preset.setAttribute('aria-label', `${card.label} preset`);
  preset.add(new Option('Custom', ''));
  for (const entry of card.presets) preset.add(new Option(entry.label, entry.id));
  const showMatch = (): void => {
    preset.value = String(card.match(current()) ?? '');
  };
  showMatch();
  preset.onchange = (): void => commit(card.apply(current(), preset.value));
  const presetLabel = el('label', 'field-wrap', 'Starting point');
  presetLabel.appendChild(preset);
  const page = insertPage(
    wideColumn(presetLabel),
    ...insertKnobs(ctx, slot, index, card.knobs, showMatch),
  );
  page.classList.add(`${card.kind}-card`);
  return page;
}

export function presetInsertCard<S extends Switchable>(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  card: PresetCardSpec<S>,
): readonly InsertPage[] {
  return [{ name: card.label, build: () => presetPage(ctx, slot, index, card) }];
}
