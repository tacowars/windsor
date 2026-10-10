/**
 * The Parts tab's patch library (#435): which patch the selected part plays,
 * and where that patch lives. A part's `preset` names a document patch
 * (`patches` section) or a built-in (`PRESETS`); the first knob edit on a
 * built-in copies it into the document under the same name — a document
 * patch shadows the built-in it was forked from — and from then on the
 * export carries it. Each part plays its own copy (windsor#669), linked to
 * its library entry by `patchSource` when the ids differ. Rename moves the
 * document patch and the part that plays it; revert puts the library's
 * version back under the same id. Both are live edits (#629): nothing here
 * rebuilds the system.
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
 * Rename the document patch the part plays, and the part playing it (one
 * part since windsor#669; its `patchSource` stays, and a copy renamed off
 * a library id takes that id as its `patchSource`, windsor#671) — one live partial
 * (#629): the patch under its new id, `null` under the old, and the playing
 * part's `preset` switched, so the engine validates the three together and
 * no part is ever left naming a patch that has gone. `name` is
 * the browser's (windsor#522): the display name to give it, else the name
 * follows the id only where the two were the same.
 */
export function renamePatch(ctx: AppCtx, from: string, to: string, name?: string): void {
  const patch = ctx.model.doc.patches?.[from];
  if (!patch || to === '') return;
  const shown = name ?? (patch.name === from ? to : patch.name);
  if (to === from) {
    // The browser's rename of a name whose id stays (windsor#522): the name alone.
    if (shown === patch.name) return;
    if (!ctx.change({ patches: { [from]: { ...patch, name: shown } } }).ok) return;
    ctx.render();
    return ctx.notify(`renamed "${patch.name}" to "${shown}"`, 'success');
  }
  if (ctx.model.doc.patches?.[to])
    return ctx.notify(`a document patch "${to}" already exists`, 'warning');
  // A copy renamed off its library id keeps the link (windsor#671 decision 5).
  const link = Object.hasOwn(library.entries, from) ? from : undefined;
  const parts: Record<number, { preset: string; patchSource?: string }> = {};
  for (const part of ctx.model.doc.parts) {
    if (part.preset !== from) continue;
    const source = part.patchSource ?? link;
    parts[part.slot] = source === undefined ? { preset: to } : { preset: to, patchSource: source };
  }
  const renamed: Patch = { ...patch, name: shown };
  const result = ctx.change({ patches: { [from]: null, [to]: renamed }, parts });
  if (!result.ok) return;
  // A renamed copy is the user's, never an automatic one (windsor#671).
  ctx.autoCopies.renamed(from, to);
  ctx.render();
  ctx.notify(
    name === undefined
      ? `renamed document patch "${from}" to "${to}"`
      : `renamed "${patch.name}" to "${shown}"`,
    'success',
  );
}

/**
 * Back to the library's version: the document copy `name` is overwritten
 * with the library entry `source` (the part's `patchSource` when it has one,
 * windsor#669), live (#629). For an id baked into the page that is exactly
 * what dropping the fork used to leave behind — the normaliser's library fill
 * re-embedded the built-in under the same id on the rebuild — without the
 * rebuild; a folder-only id (#563) has no baked fallback and took this path
 * already.
 */
export function revertPatch(
  ctx: AppCtx,
  name: string,
  model: LibraryModel = library,
  source = name,
): void {
  const entry = libraryPatch(model, source);
  if (!entry) return;
  if (!ctx.change({ patches: { [name]: clonePatch(entry) } }).ok) return;
  ctx.render();
  ctx.notify(
    Object.hasOwn(builtInPresets(), source)
      ? `document patch "${name}" reset to the built-in`
      : `document patch "${name}" reset to the library copy`,
    'success',
  );
}

/** A result row's source, capitalised as the approved mockup shows it: the popover's rows and the browser's. */
export const ROW_SOURCE_LABELS: Readonly<Record<PresetListing['source'], string>> = {
  document: 'This song',
  library: 'Library',
  'built-in': 'Built-in',
};

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
  const part = partAt(ctx.model.doc, slot);
  const preset = part?.preset ?? '';
  const listed = entries.find((entry) => entry.id === preset);
  // A part's own copy (windsor#669) shows its library entry's category.
  const linked = part?.patchSource && entries.find((entry) => entry.id === part.patchSource);
  const category = (linked || listed)?.category;
  const name = ctx.model.doc.patches?.[preset]?.name ?? listed?.name ?? preset;
  const source =
    patchHome(ctx, slot) === 'document'
      ? PATCH_SOURCE_LABELS.document
      : listed && PATCH_SOURCE_LABELS[listed.source];
  return { name, detail: [category, source].filter(Boolean).join(' · ') };
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
  const part = partAt(ctx.model.doc, slot);
  if (part === undefined || patchHome(ctx, slot) !== 'document') return [];
  const { preset } = part;
  const source = part.patchSource ?? preset;
  const items: MenuItem[] = [
    {
      kind: 'form',
      label: 'Rename…',
      title: "Rename the song's copy of this patch; the part playing it follows",
      form: () => renameForm(ctx, preset),
    },
  ];
  if (libraryPatch(library, source))
    items.push({
      kind: 'action',
      label: 'Revert to library',
      title: 'Back to the library file; the part playing this patch follows',
      enabled: true,
      run: () => revertPatch(ctx, preset, library, source),
    });
  return items;
}
