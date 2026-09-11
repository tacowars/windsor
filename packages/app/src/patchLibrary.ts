/**
 * The Parts tab's patch library (#435): which patch the selected part plays,
 * and where that patch lives. A part's `preset` names a document patch
 * (`patches` section) or a built-in (`PRESETS`); the first knob edit on a
 * built-in copies it into the document under the same name — a document
 * patch shadows the built-in it was forked from — and from then on the
 * export carries it. Rename moves the document patch and every part that
 * plays it; revert drops the fork and the part falls back to the built-in.
 */
import type { MusicPartId, Patch } from '../../../packages/client/src/audio/index-for-editor';
import { PRESETS, PRESET_NAMES } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { SLOT_IDS } from './context';
import { el, select } from './dom';

type Slots = Record<string, { preset?: string } | undefined>;

/** Where the selected part's patch lives, for the badge and the controls. */
export function patchHome(ctx: AppCtx, id: MusicPartId): 'document' | 'built-in' | 'none' {
  const slot = ctx.model.doc[id];
  if (!slot) return 'none';
  if (ctx.model.doc.patches?.[slot.preset]) return 'document';
  return PRESETS[slot.preset] ? 'built-in' : 'none';
}

export function presetPicker(ctx: AppCtx, id: MusicPartId, onPick: () => void): HTMLElement {
  const docNames = Object.keys(ctx.model.doc.patches ?? {}).sort();
  const options = [
    ...docNames.map((name) => ({ value: name, label: `${name} · document` })),
    ...PRESET_NAMES.filter((name) => !docNames.includes(name)).map((name) => ({
      value: name,
      label: `${PRESETS[name]?.name ?? name} · built-in`,
    })),
  ];
  return select('Patch (in the document)', options, ctx.model.doc[id]?.preset ?? '', (name) => {
    const result = ctx.change({ [id]: { preset: name } });
    if (result.ok) onPick();
  });
}

export function badgeText(ctx: AppCtx, id: MusicPartId): string {
  const preset = ctx.model.doc[id]?.preset ?? '';
  switch (patchHome(ctx, id)) {
    case 'document':
      return `Document patch "${preset}" — every knob edit lands in the export.`;
    case 'built-in':
      return `Built-in "${preset}" — the first knob edit copies it into the document as "${preset}".`;
    default:
      return 'No part selected.';
  }
}

/** Rename the document patch the part plays, and every part playing it. */
function renamePatch(ctx: AppCtx, from: string, to: string): void {
  if (to === '' || to === from) return;
  if (ctx.model.doc.patches?.[to]) return ctx.status(`a document patch "${to}" already exists`);
  ctx.restructure((draft) => {
    const patches = (draft.patches ?? {}) as Record<string, Patch>;
    const patch = patches[from];
    if (!patch) return;
    delete patches[from];
    patches[to] = { ...patch, name: patch.name === from ? to : patch.name };
    draft.patches = patches;
    for (const id of SLOT_IDS) {
      const slot = (draft as Slots)[id];
      if (slot?.preset === from) slot.preset = to;
    }
  });
  ctx.status(`renamed document patch "${from}" to "${to}"`);
}

/** Drop the document's fork of a built-in; the parts playing it fall back to the built-in. */
function revertPatch(ctx: AppCtx, name: string): void {
  ctx.restructure((draft) => {
    const patches = (draft.patches ?? {}) as Record<string, Patch>;
    delete patches[name];
    if (Object.keys(patches).length === 0) delete draft.patches;
    else draft.patches = patches;
  });
  ctx.status(`document patch "${name}" dropped — back on the built-in`);
}

/** Rename and revert, shown only for a document patch. */
export function libraryControls(ctx: AppCtx, id: MusicPartId): HTMLElement {
  const box = el('div', 'bar-row');
  box.style.marginTop = '8px';
  const preset = ctx.model.doc[id]?.preset;
  if (preset === undefined || patchHome(ctx, id) !== 'document') return box;
  const name = document.createElement('input');
  name.className = 'field';
  name.name = 'patch-name';
  name.value = preset;
  name.setAttribute('aria-label', 'Document patch name');
  box.appendChild(name);
  const rename = el('button', 'btn', 'Rename') as HTMLButtonElement;
  rename.type = 'button';
  rename.onclick = (): void => renamePatch(ctx, preset, name.value.trim());
  box.appendChild(rename);
  if (PRESETS[preset]) {
    const revert = el('button', 'btn', 'Revert to built-in') as HTMLButtonElement;
    revert.type = 'button';
    revert.title = 'Drop the document copy; parts playing it use the built-in again';
    revert.onclick = (): void => revertPatch(ctx, preset);
    box.appendChild(revert);
  }
  return box;
}
