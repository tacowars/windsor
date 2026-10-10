/**
 * The Parts tab's part + patch bar (windsor#521; record
 * `2026-10-03-parts-tab-layout` decisions 4–5, the mockup's layout B):
 * `PART`, the name and the sequencer; then `PATCH`, ◀ ▶, the patch box (the
 * name, the unsaved dot and `<category> · <source>`; a click opens the search
 * popover), Save, Save as…, Init and the ⋯ menu; and at the right end
 * ⤢ Browse patches, which opens the full-pane browser under the bar
 * (`patchBrowser.ts`, windsor#522) and shows as pressed while it is open. It
 * is a flex row that wraps by its own width, never by the screen's.
 */
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { libraryButtons, libraryMenuEntries } from './libraryActions';
import { partListControls } from './partListControls';
import { badgeText, patchMenuEntries, patchSummary } from './patchLibrary';
import type { MenuItem } from './patchMenu';
import { SEPARATOR, patchMenu } from './patchMenu';
import {
  focusBrowserSearch,
  isPatchBrowserOpen,
  openPatchBrowser,
  syncPatchBrowser,
  togglePatchBrowser,
} from './patchBrowser';
import { togglePatchPopover, wirePatchSearchKey } from './patchPopover';
import type { StepDirection } from './patchStepModel';
import { stepPartPatch } from './patchStepModel';
import type { PatchLoader } from './presetBrowser';
import { filteredListing, loadPreset, presetListing } from './presetBrowser';

export interface PatchBarActions extends PatchLoader {
  /** Reload the working patch and rebuild the bar and the editor: after a library action. */
  readonly refresh: () => void;
  /** Open the Patch JSON dialog; closing it hands focus back to `opener`. */
  readonly openJson: (opener: HTMLElement) => void;
}

const STEP_LABELS: Readonly<Record<StepDirection, string>> = {
  [-1]: 'Previous patch',
  1: 'Next patch',
};

const focusById = (id: string) => (): void => document.getElementById(id)?.focus();

function stepButton(ctx: AppCtx, by: StepDirection, actions: PatchBarActions): HTMLElement {
  const node = el('button', 'btn icon', by > 0 ? '▶' : '◀') as HTMLButtonElement;
  node.type = 'button';
  node.id = by > 0 ? 'patchNext' : 'patchPrev';
  node.title = `${STEP_LABELS[by]} in the search's filter`;
  node.setAttribute('aria-label', STEP_LABELS[by]);
  node.onclick = (): void => {
    // A part's own copy steps from its library entry's place when its row is hidden (windsor#669).
    const part = partAt(ctx.model.doc, ctx.parts.selected);
    const listing = presetListing(ctx);
    const next = stepPartPatch({
      order: filteredListing(listing).map((entry) => entry.id),
      all: listing.map((entry) => entry.id),
      preset: part?.preset ?? '',
      patchSource: part?.patchSource,
      by,
    });
    if (next !== null) loadPreset(ctx, next, actions, focusById(node.id));
  };
  return node;
}

function patchBox(ctx: AppCtx, actions: PatchBarActions): HTMLElement {
  const wrap = el('div', 'patch-box-wrap');
  const entries = presetListing(ctx);
  const slot = ctx.parts.selected;
  const summary = patchSummary(ctx, slot, entries);
  const box = el('button', 'patch-box') as HTMLButtonElement;
  box.type = 'button';
  box.id = 'patchBox';
  box.title = badgeText(ctx, slot);
  box.setAttribute('aria-haspopup', 'listbox');
  const dot = el('i', 'patch-box-mod');
  dot.id = 'patchModified';
  dot.title = 'Edited since saved';
  dot.setAttribute('aria-label', 'unsaved edits');
  dot.hidden = true;
  box.append(
    el('span', 'patch-box-name', summary.name),
    dot,
    el('span', 'patch-box-src', summary.detail),
    el('span', 'patch-box-search', '⌕ search'),
  );
  box.onclick = (): void => {
    // The open browser is the search already: the box and ⌘K go to its field.
    if (isPatchBrowserOpen()) return focusBrowserSearch();
    togglePatchPopover({
      anchor: wrap,
      entries,
      current: partAt(ctx.model.doc, slot)?.preset ?? '',
      load: (id) => loadPreset(ctx, id, actions, focusById('patchBox')),
      browse: () => openPatchBrowser(ctx, actions),
    });
  };
  wrap.appendChild(box);
  return wrap;
}

function menuItems(ctx: AppCtx, actions: PatchBarActions): MenuItem[] {
  const own = patchMenuEntries(ctx, ctx.parts.selected);
  return [
    ...own,
    ...libraryMenuEntries(ctx, actions.refresh),
    SEPARATOR,
    {
      kind: 'action',
      label: 'Patch JSON',
      title: 'View, copy or paste the working patch as JSON',
      enabled: true,
      run: (opener) => actions.openJson(opener),
    },
  ];
}

/** Save, Save as… and Init with ids, so focus finds them again in a rebuilt bar (windsor#537). */
function libraryRow(ctx: AppCtx, actions: PatchBarActions): HTMLButtonElement[] {
  const buttons = libraryButtons(ctx, actions.refresh);
  const ids = ['patchSave', 'patchSaveAs', 'patchInit'];
  buttons.forEach((button, i) => (button.id = ids[i] ?? ''));
  return buttons;
}

/**
 * The bar for the selected part; rebuilt whole after a pick, a library action
 * or a part switch. Each control has an id, so the rebuild can hand focus to
 * the new copy of the control that had it (`keepBarFocus`).
 */
export function patchBar(ctx: AppCtx, actions: PatchBarActions): HTMLElement[] {
  wirePatchSearchKey();
  const browse = el('button', 'btn patch-browse', '⤢ Browse patches') as HTMLButtonElement;
  browse.type = 'button';
  browse.id = 'patchBrowse';
  browse.title = 'Browse every patch in a full pane: facets, a table and an info pane';
  browse.setAttribute('aria-pressed', String(isPatchBrowserOpen()));
  browse.onclick = (): void => togglePatchBrowser(ctx, actions);
  // The pane follows the bar it hangs under, once the bar is in the page.
  queueMicrotask(() => syncPatchBrowser(ctx, actions));
  return [
    ...partListControls(ctx),
    el('span', 'bar-sep'),
    el('span', 'field-label bar-label', 'Patch'),
    stepButton(ctx, -1, actions),
    stepButton(ctx, 1, actions),
    patchBox(ctx, actions),
    ...libraryRow(ctx, actions),
    patchMenu('Rename, delete, library folder, patch JSON', () => menuItems(ctx, actions)),
    el('span', 'bar-grow'),
    browse,
  ];
}

/**
 * Rebuild the bar with `build`, and give focus back to the rebuilt copy of
 * the control that had it (windsor#537 decision 2): a library action that
 * ends in a refresh would otherwise leave focus on the page body, and Tab is
 * the tab switch, so the keyboard could not come back.
 */
export function keepBarFocus(bar: HTMLElement, build: () => void): void {
  const active = document.activeElement;
  const id = active instanceof HTMLElement && bar.contains(active) ? active.id : '';
  build();
  if (!id || document.activeElement !== document.body) return;
  document.getElementById(id)?.focus();
}
