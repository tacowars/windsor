/**
 * Choosing a patch for a part, and the retained filter the patch bar's ◀ ▶
 * and its search popover share (windsor#521). Filtering never changes the
 * song; a pick copies the patch into it.
 */
import { clonePatch, filterPresets, partAt } from '@windsor/engine';
import type { PresetFilter, PresetListing } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el } from './dom';
import { withGesture } from './gestureHooks';
import { library, libraryPatch } from './libraryModel';
import { assignPatchFields } from './partAutoName';
import { leftCopyDrop } from './partCopyCleanup';
import { copyId, copySource, playerElsewhere } from './partPatchIsolation';
import { PATCH_SOURCE_LABELS } from './patchLibrary';
import { stepListing } from './patchStepModel';

/** Retained across a rail rebuild, a part switch and the popover closing. */
export const patchFilter: PresetFilter = { query: '', category: '', tag: '', source: '' };

/**
 * Copy on selection: the exported song owns the sound even before its first
 * knob edit. Each part owns its patch (windsor#669 decision 2): when another
 * part plays `name`, this part gets the same sound under a fresh id, linked
 * to its library entry by `patchSource`, so neither part's knobs move the
 * other's. A part re-picking what it plays keeps its link; any other pick
 * clears it. The unedited automatic copy the part leaves goes in the same
 * change (windsor#671), so undo brings it back with the part's old patch.
 */
export function choosePreset(ctx: AppCtx, slot: number, name: string): boolean {
  const doc = ctx.model.doc;
  const existing = doc.patches;
  const documentPatch = existing && Object.hasOwn(existing, name) ? existing[name] : undefined;
  const patch = documentPatch ?? libraryPatch(library, name);
  if (!patch) return false;
  const holder = playerElsewhere(doc, slot, name);
  const ids = new Set(Object.keys(library.entries));
  const id = holder ? copyId(doc, name, ids) : name;
  const fields = assignPatchFields(doc, slot, id, patch.name);
  const keepsLink = !holder && partAt(doc, slot)?.preset === name;
  const link = keepsLink ? {} : { patchSource: holder && copySource(holder, name, ids) };
  const dropped = leftCopyDrop(doc, slot, id, library, ctx.autoCopies);
  const ok = ctx.change({
    ...partChange(slot, { ...fields, ...link }),
    patches: { [id]: clonePatch(patch), ...dropped },
  }).ok;
  // The copy is recorded as the app's own, so it may go when unedited (windsor#671).
  if (ok && holder) ctx.autoCopies.add(id);
  return ok;
}

/**
 * Choosing a preset, and what the pick sets off (`onPick`: the rail reload and
 * the Init discard, `dropInit`), as one undo step (windsor#130 decision 7).
 * True when the preset loaded.
 */
export function pickPreset(ctx: AppCtx, slot: number, name: string, onPick: () => void): boolean {
  return withGesture('Choose preset', () => {
    if (!choosePreset(ctx, slot, name)) return false;
    onPick();
    return true;
  });
}

/** Runs before a load lands: the unsaved-changes guard (#563) calls `proceed` or drops the pick. */
export type PickGuard = (proceed: () => void) => void;

/** How the bar loads a patch: the guard, the pick and its reload, then where focus lands. */
export interface PatchLoader {
  readonly onPick: () => void;
  readonly guard: PickGuard;
}

/**
 * Load `id` into the selected part the way a pick always has: the guard
 * first, then one undo step, then `focus` on the rebuilt bar so the QWERTY
 * keys play the new sound.
 */
export function loadPreset(ctx: AppCtx, id: string, loader: PatchLoader, focus: () => void): void {
  const slot = ctx.parts.selected;
  loader.guard(() => {
    const named = partAt(ctx.model.doc, slot)?.name;
    if (!pickPreset(ctx, slot, id, loader.onPick)) return;
    // A generic part just took its patch's name (windsor#103): the strip and the bar show it too.
    if (partAt(ctx.model.doc, slot)?.name !== named) ctx.render();
    focus();
  });
}

/** Every patch a part can load: the song's, the user's library and the built-ins. */
export const presetListing = (ctx: AppCtx): PresetListing[] =>
  stepListing(library.entries, ctx.model.doc.patches, library.userIds);

/** The ids ◀ ▶ walk and the popover lists, in the listing's order, under the retained filter. */
export const filteredListing = (entries: readonly PresetListing[]): PresetListing[] =>
  filterPresets(entries, patchFilter);

const ALL_LABELS = { category: 'All categories', tag: 'All tags', source: 'All sources' };

/** The Category, Tag and Source selects, in one row; each change refilters. */
export function filterSelects(entries: readonly PresetListing[], refresh: () => void): HTMLElement {
  const box = el('div', 'patch-pop-filters');
  for (const field of ['category', 'tag', 'source'] as const) {
    const values = [
      ...new Set(entries.flatMap((entry) => (field === 'tag' ? entry.tags : [entry[field]]))),
    ].sort();
    // Keep an active filter visible after an import/revert removes its last entry.
    if (patchFilter[field] && !values.includes(patchFilter[field])) values.push(patchFilter[field]);
    const node = document.createElement('select');
    node.className = 'field';
    node.name = `preset-${field}`;
    node.setAttribute('aria-label', `Preset ${field}`);
    node.add(new Option(ALL_LABELS[field], ''));
    for (const value of values) {
      const label =
        field === 'source'
          ? (PATCH_SOURCE_LABELS[value as PresetListing['source']] ?? value)
          : value;
      node.add(new Option(label, value));
    }
    node.value = patchFilter[field];
    node.onchange = (): void => {
      patchFilter[field] = node.value;
      refresh();
    };
    box.appendChild(node);
  }
  return box;
}
