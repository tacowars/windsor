/**
 * The Parts tab's patch library (#435): which patch the selected part plays,
 * and where that patch lives. A part's `preset` names a document patch
 * (`patches` section) or a built-in (`PRESETS`); the first knob edit on a
 * built-in copies it into the document under the same name — a document
 * patch shadows the built-in it was forked from — and from then on the
 * export carries it. Rename moves the document patch and every part that
 * plays it; revert puts the library's version back under the same id. Both
 * are live edits (#629): nothing here rebuilds the system.
 */
import type { Patch, PresetListing } from '@windsor/engine';
import { clonePatch, partAt } from '@windsor/engine';
import { builtInPresets } from './builtInLibrary';
import type { AppCtx } from './context';
import { el } from './dom';
import type { LibraryModel } from './libraryModel';
import { library, libraryPatch } from './libraryModel';
import type { MenuItem } from './patchMenu';

/** Where the selected part's patch lives, for the badge and the controls. */
export function patchHome(ctx: AppCtx, slot: number): 'document' | 'built-in' | 'none' {
  const part = partAt(ctx.model.doc, slot);
  if (!part) return 'none';
  if (ctx.model.doc.patches?.[part.preset]) return 'document';
  return libraryPatch(library, part.preset) ? 'built-in' : 'none';
}

export function badgeText(ctx: AppCtx, slot: number): string {
  const preset = partAt(ctx.model.doc, slot)?.preset ?? '';
  switch (patchHome(ctx, slot)) {
    case 'document':
      return `Document patch "${preset}" — every knob edit lands in the export.`;
    case 'built-in':
      return `Built-in "${preset}" — the first knob edit copies it into the document as "${preset}".`;
    default:
      return 'No part selected.';
  }
}

/**
 * Rename the document patch the part plays, and every part playing it — one
 * live partial (#629): the patch under its new id, `null` under the old, and
 * each playing part's `preset` switched, so the engine validates the three
 * together and no part is ever left naming a patch that has gone.
 */
export function renamePatch(ctx: AppCtx, from: string, to: string): void {
  if (to === '' || to === from) return;
  if (ctx.model.doc.patches?.[to])
    return ctx.notify(`a document patch "${to}" already exists`, 'warning');
  const patch = ctx.model.doc.patches?.[from];
  if (!patch) return;
  const parts: Record<number, { preset: string }> = {};
  for (const part of ctx.model.doc.parts)
    if (part.preset === from) parts[part.slot] = { preset: to };
  const renamed: Patch = { ...patch, name: patch.name === from ? to : patch.name };
  const result = ctx.change({ patches: { [from]: null, [to]: renamed }, parts });
  if (!result.ok) return;
  ctx.render();
  ctx.notify(`renamed document patch "${from}" to "${to}"`, 'success');
}

/**
 * Back to the library's version: the document copy is overwritten with the
 * library entry, live (#629). For an id baked into the page that is exactly
 * what dropping the fork used to leave behind — the normaliser's library fill
 * re-embedded the built-in under the same id on the rebuild — without the
 * rebuild; a folder-only id (#563) has no baked fallback and took this path
 * already.
 */
export function revertPatch(ctx: AppCtx, name: string, model: LibraryModel = library): void {
  const entry = libraryPatch(model, name);
  if (!entry) return;
  if (!ctx.change({ patches: { [name]: clonePatch(entry) } }).ok) return;
  ctx.render();
  ctx.notify(
    Object.hasOwn(builtInPresets(), name)
      ? `document patch "${name}" reset to the built-in`
      : `document patch "${name}" reset to the library copy`,
    'success',
  );
}

/** The patch box's source words (windsor#521), one per listing source. */
export const PATCH_SOURCE_LABELS: Readonly<Record<PresetListing['source'], string>> = {
  document: 'this song',
  library: 'library',
  'built-in': 'built-in',
};

/** What the patch box shows for the part's patch: its name, and `<category> · <source>`. */
export function patchSummary(
  ctx: AppCtx,
  slot: number,
  entries: readonly PresetListing[],
): { name: string; detail: string } {
  const preset = partAt(ctx.model.doc, slot)?.preset ?? '';
  const listed = entries.find((entry) => entry.id === preset);
  const name = ctx.model.doc.patches?.[preset]?.name ?? listed?.name ?? preset;
  const source =
    patchHome(ctx, slot) === 'document'
      ? PATCH_SOURCE_LABELS.document
      : listed && PATCH_SOURCE_LABELS[listed.source];
  return { name, detail: [listed?.category, source].filter(Boolean).join(' · ') };
}

/** Rename's field in the ⋯ menu: the document patch's id, committed on Enter or the button. */
function renameForm(ctx: AppCtx, preset: string): HTMLElement {
  const form = el('form', 'patch-menu-form') as HTMLFormElement;
  const name = document.createElement('input');
  name.className = 'field';
  name.name = 'patch-name';
  name.value = preset;
  name.setAttribute('aria-label', 'Document patch name');
  const rename = el('button', 'btn', 'Rename') as HTMLButtonElement;
  rename.type = 'submit';
  form.onsubmit = (event): void => {
    event.preventDefault();
    renamePatch(ctx, preset, name.value.trim());
  };
  form.append(name, rename);
  queueMicrotask(() => name.select());
  return form;
}

/** Rename and Revert to library for the ⋯ menu, offered only for a document patch. */
export function patchMenuEntries(ctx: AppCtx, slot: number): MenuItem[] {
  const preset = partAt(ctx.model.doc, slot)?.preset;
  if (preset === undefined || patchHome(ctx, slot) !== 'document') return [];
  const items: MenuItem[] = [
    {
      kind: 'form',
      label: 'Rename…',
      title: "Rename the song's copy of this patch; parts playing it follow",
      form: () => renameForm(ctx, preset),
    },
  ];
  if (libraryPatch(library, preset))
    items.push({
      kind: 'action',
      label: 'Revert to library',
      title: 'Back to the library file; parts playing this patch follow',
      enabled: true,
      run: () => revertPatch(ctx, preset),
    });
  return items;
}
