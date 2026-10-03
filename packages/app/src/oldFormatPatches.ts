/**
 * The library's old-format patches (`2026-09-28-format-versions-refuse-never-destroy`):
 * stored patches this build cannot read, listed under the library row with
 * an "old format" badge. They are never in the preset browser, so never
 * played or assigned; each offers Export (the stored text, as-is) and
 * Delete, which asks first. Nothing is dropped silently.
 *
 * The rows sit in the ⋯ menu, so a deletion keeps the keyboard there
 * (windsor#537): the row leaves in place and focus goes to the next row's
 * Delete (`rowAfterRemoval`); when none is left, or the menu already closed,
 * the bar is rebuilt and focus goes back to ⋯.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import type { OldFormatPatch } from './libraryFolder';
import type { LibraryModel } from './libraryModel';
import { exportOldFormat, removeOldFormat } from './libraryModel';
import { openConfirm } from './metadataModal';
import { PATCH_MENU_ID, refocusMenu } from './patchMenu';
import { rowAfterRemoval } from './patchMenuKeys';

const DELETE_CLASS = 'old-format-delete';

/** Focus ⋯ if focus fell to the page (a closed menu, a rebuilt bar). */
function refocusToggle(): void {
  const toggle = document.getElementById(PATCH_MENU_ID);
  if (toggle) refocusMenu(toggle);
}

/** Take `line` out of its list and hand focus on, as the header says. */
function removeRow(line: HTMLElement, refresh: () => void): void {
  const box = line.parentElement;
  const rows = box ? [...box.children] : [];
  const next = box?.isConnected ? rowAfterRemoval(rows.length, rows.indexOf(line)) : null;
  line.remove();
  const target = next === null ? null : rows[next]?.querySelector<HTMLElement>(`.${DELETE_CLASS}`);
  if (target) return target.focus();
  refresh();
  refocusToggle();
}

/** A button whose failure is an error toast. */
function action(
  ctx: AppCtx,
  label: string,
  title: string,
  run: () => Promise<void> | void,
): HTMLElement {
  const node = el('button', 'btn', label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.onclick = (): void => {
    Promise.resolve()
      .then(run)
      .catch((error: unknown) => ctx.notify(String(error), 'error'));
  };
  return node;
}

function row(
  ctx: AppCtx,
  model: LibraryModel,
  entry: OldFormatPatch,
  refresh: () => void,
): HTMLElement {
  const line = el('div', 'bar-row');
  line.append(
    el('span', 'status', entry.name),
    el('span', 'status hot', 'old format'),
    el('span', 'hint', entry.refusal.message),
  );
  const exportBtn = action(ctx, 'Export', `Download ${entry.id}.json exactly as stored`, () => {
    exportOldFormat(model, entry.id);
    ctx.notify(`exported ${entry.id}.json as stored`, 'success');
  });
  const deleteBtn = action(ctx, 'Delete', 'Remove this old patch from your library', async () => {
    const ok = await openConfirm({
      title: `Delete "${entry.name}"?`,
      body: 'This build cannot read it, so it is not playable. Export it first to keep a copy.',
      ok: 'Delete',
      opener: deleteBtn,
    });
    if (!ok) return refocusToggle();
    await removeOldFormat(model, entry.id);
    ctx.notify(`deleted the old-format patch "${entry.id}"`, 'success');
    removeRow(line, refresh);
  });
  deleteBtn.classList.add(DELETE_CLASS);
  line.append(exportBtn, deleteBtn);
  return line;
}

/** The list under the library row; empty when every stored patch is readable. */
export function oldFormatList(ctx: AppCtx, model: LibraryModel, refresh: () => void): HTMLElement {
  const box = el('div', 'old-format');
  for (const entry of model.oldFormat) box.appendChild(row(ctx, model, entry, refresh));
  return box;
}
