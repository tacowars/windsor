/**
 * The Parts tab's part + patch bar (windsor#521; record
 * `2026-10-03-parts-tab-layout` decisions 4–5, the mockup's layout B):
 * `PART`, the name and the sequencer; then `PATCH`, ◀ ▶, the patch box (the
 * name, the unsaved dot and `<category> · <source>`; a click opens the search
 * popover), Save, Save as…, Init and the ⋯ menu; and at the right end
 * ⤢ Browse patches, hidden until the full browser lands (windsor#522). It is
 * a flex row that wraps by its own width, never by the screen's.
 */
import { partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { libraryButtons, libraryMenuEntries } from './libraryActions';
import { partListControls } from './partListControls';
import { badgeText, patchMenuEntries, patchSummary } from './patchLibrary';
import type { MenuItem } from './patchMenu';
import { SEPARATOR, patchMenu } from './patchMenu';
import { togglePatchPopover, wirePatchSearchKey } from './patchPopover';
import type { StepDirection } from './patchStepModel';
import { stepPatch } from './patchStepModel';
import type { PatchLoader } from './presetBrowser';
import { filteredListing, loadPreset, presetListing } from './presetBrowser';

export interface PatchBarActions extends PatchLoader {
  /** Reload the working patch and rebuild the bar and the editor: after a library action. */
  readonly refresh: () => void;
  /** Open the Patch JSON dialog. */
  readonly openJson: () => void;
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
    const current = partAt(ctx.model.doc, ctx.parts.selected)?.preset ?? '';
    const order = filteredListing(presetListing(ctx)).map((entry) => entry.id);
    const next = stepPatch(order, current, by);
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
  box.onclick = (): void =>
    togglePatchPopover({
      anchor: wrap,
      entries,
      current: partAt(ctx.model.doc, slot)?.preset ?? '',
      load: (id) => loadPreset(ctx, id, actions, focusById('patchBox')),
    });
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
      run: () => actions.openJson(),
    },
  ];
}

/** The bar for the selected part; rebuilt whole after a pick, a library action or a part switch. */
export function patchBar(ctx: AppCtx, actions: PatchBarActions): HTMLElement[] {
  wirePatchSearchKey();
  const browse = el('button', 'btn', '⤢ Browse patches') as HTMLButtonElement;
  browse.type = 'button';
  // The full-pane browser is windsor#522; until then the button is not shown.
  browse.hidden = true;
  return [
    ...partListControls(ctx),
    el('span', 'bar-sep'),
    el('span', 'field-label bar-label', 'Patch'),
    stepButton(ctx, -1, actions),
    stepButton(ctx, 1, actions),
    patchBox(ctx, actions),
    ...libraryButtons(ctx, actions.refresh),
    patchMenu('Rename, delete, library folder, patch JSON', () => menuItems(ctx, actions)),
    el('span', 'bar-grow'),
    browse,
  ];
}
