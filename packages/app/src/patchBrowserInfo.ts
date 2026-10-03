/**
 * The patch browser's info pane (windsor#522 decision 5): the selected row's
 * name, `<category> · <source>`, tags, description, the algorithm, carrier,
 * filter and drive line, and a sketch of the first carrier's envelope; then
 * Load into <part>, Save as…, Rename, Delete and Show in folder. What Rename
 * and Delete act on is `rowActions` (`patchBrowserModel.ts`); the writes are
 * `patchActions.ts` and `patchLibrary.ts`'s, as the bar's ⋯ menu uses them.
 */
import type { Patch, PresetListing } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import { CARRIER_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { drawEnv } from './envCanvas';
import { LIBRARY_FOLDER_PATH } from './libraryConstants';
import { isWritable, library, libraryPatch } from './libraryModel';
import { checkLoudness } from './loudnessCheck';
import { openConfirm, openMetadataModal } from './metadataModal';
import {
  copyToLibrary,
  deletePatch,
  deleteRefusal,
  deleteSongPatch,
  renameLibraryPatch,
} from './patchActions';
import type { ActionTarget } from './patchBrowserModel';
import { patchInfo, rowActions } from './patchBrowserModel';
import { renamePatch } from './patchLibrary';
import { writtenText } from './libraryActions';
import { copyMetadata, nameProblem, slugify, uniqueId } from './patchMetadata';

export interface InfoHooks {
  /** Load the id into the part, as a pick does (the unsaved guard, one undo step). */
  readonly load: (id: string) => void;
  /** After a library action: select `next` if given, reload the bar and the pane, focus the results. */
  readonly done: (next?: string) => void;
}

/** The selected row's patch: the song's copy, else the library's. */
const rowPatch = (ctx: AppCtx, id: string): Patch | undefined =>
  ctx.model.doc.patches?.[id] ?? libraryPatch(library, id);

const songIds = (ctx: AppCtx): string[] => Object.keys(ctx.model.doc.patches ?? {});

function actionButton(
  label: string,
  title: string,
  enabled: boolean,
  cls = 'btn',
): HTMLButtonElement {
  const node = el('button', cls, label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.disabled = !enabled;
  return node;
}

/** Runs an action and reports its failure as an error toast. */
function run(ctx: AppCtx, action: () => Promise<void>): void {
  action().catch((error: unknown) => ctx.notify(String(error), 'error'));
}

/** The library entry's metadata, else the row's (a song's own patch has no entry). */
function rowMetadata(row: PresetListing): {
  category: string;
  tags: string[];
  description: string;
} {
  const entry = Object.hasOwn(library.entries, row.id) ? library.entries[row.id] : undefined;
  return {
    category: entry?.category ?? row.category,
    tags: [...(entry?.tags ?? row.tags)],
    description: entry?.description ?? '',
  };
}

/** Save as…: the row's patch as a new library patch; the new id, or null on Cancel. */
async function saveAs(
  ctx: AppCtx,
  row: PresetListing,
  patch: Patch,
  opener: HTMLElement,
): Promise<string | null> {
  const taken = [...Object.keys(library.entries), ...songIds(ctx)];
  const meta = await openMetadataModal(
    {
      title: 'Save as…',
      hint: `Copies "${row.name}" to a new patch in your library. The part keeps playing what it plays.`,
      initial: copyMetadata({ name: row.name, ...rowMetadata(row) }),
      entries: library.entries,
      id: (name) => uniqueId(slugify(name), taken),
      loudness: checkLoudness(patch),
      opener,
    },
    patch.volume,
  );
  if (!meta) return null;
  const id = await copyToLibrary(library, patch, meta, songIds(ctx));
  ctx.notify(writtenText(library, id), 'success');
  return id;
}

async function remove(
  ctx: AppCtx,
  row: PresetListing,
  target: ActionTarget,
  opener: HTMLElement,
): Promise<boolean> {
  const where = library.folder ? `${row.id}.json from the library folder` : 'it from your library';
  const ok = await openConfirm({
    title: `Delete "${row.name}"?`,
    body:
      target === 'library'
        ? `Removes ${where}. Songs keep their own copies, this one included.`
        : 'Removes the copy this song keeps. No part plays it; Undo brings it back.',
    ok: 'Delete',
    opener,
  });
  if (!ok) return false;
  if (target === 'song') return deleteSongPatch(ctx, row.id);
  await deletePatch(library, row.id);
  ctx.notify(
    library.folder ? `deleted ${row.id}.json` : `deleted "${row.name}" from your library`,
    'success',
  );
  return true;
}

/** Rename's form in place of the name: Enter or Rename commits, Esc or Cancel puts the name back. */
function renameForm(
  ctx: AppCtx,
  row: PresetListing,
  target: ActionTarget,
  hooks: InfoHooks,
  back: () => void,
): HTMLElement {
  const form = el('form', 'pb-rename') as HTMLFormElement;
  const input = document.createElement('input');
  input.className = 'field';
  input.name = 'patch-browser-name';
  input.value = row.name;
  input.setAttribute('aria-label', 'Patch name');
  const commit = actionButton('Rename', 'Rename the patch', true, 'btn primary');
  commit.type = 'submit';
  const cancel = actionButton('Cancel', 'Keep the name', true);
  cancel.onclick = back;
  input.onkeydown = (event): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    back();
  };
  form.onsubmit = (event): void => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name || name === row.name) return back();
    if (target === 'song') {
      const slug = slugify(name);
      const others = [...Object.keys(library.entries), ...songIds(ctx)].filter(
        (id) => id !== row.id,
      );
      const to = slug === row.id ? row.id : uniqueId(slug, others);
      renamePatch(ctx, row.id, to, name);
      return hooks.done(ctx.model.doc.patches?.[to] ? to : row.id);
    }
    const problem = nameProblem(name, library.entries, row.id);
    if (problem) return ctx.notify(problem, 'warning');
    run(ctx, async () => {
      await renameLibraryPatch(library, row.id, name);
      ctx.notify(`renamed "${row.name}" to "${name}"`, 'success');
      hooks.done(row.id);
    });
  };
  form.append(input, commit, cancel);
  queueMicrotask(() => input.select());
  return form;
}

/** One observer for the pane's one sketch: it redraws when the canvas's box changes (decision 9). */
let sketchObserver: ResizeObserver | null = null;

function envelopeSketch(env: ReturnType<typeof patchInfo>['envelope']): HTMLElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'pb-env';
  canvas.setAttribute('aria-hidden', 'true');
  sketchObserver?.disconnect();
  if (env) {
    sketchObserver = new ResizeObserver(() => drawEnv(canvas, env, CARRIER_COLOR));
    sketchObserver.observe(canvas);
  }
  return canvas;
}

/** The pane for `row`, or a line saying nothing is selected. */
// eslint-disable-next-line max-lines-per-function -- one pane: its fields, then its buttons wired in the order they show
export function browserInfo(ctx: AppCtx, row: PresetListing | null, hooks: InfoHooks): HTMLElement {
  const pane = el('div', 'pb-info');
  const patch = row ? rowPatch(ctx, row.id) : undefined;
  if (!row || !patch) {
    pane.appendChild(el('p', 'hint', 'No patch matches the search and the facets.'));
    return pane;
  }
  const info = patchInfo(row, patch);
  const part = partAt(ctx.model.doc, ctx.parts.selected);
  const { rename, remove: removal } = rowActions({
    inSong: Object.hasOwn(ctx.model.doc.patches ?? {}, row.id),
    writable: isWritable(library, row.id),
    played: ctx.model.doc.parts.some((each) => each.preset === row.id),
    refusal: deleteRefusal(row.id),
  });
  const name = el('div', 'pb-name', info.name);
  const tags = el('div', 'pb-chips');
  for (const tag of info.tags) tags.appendChild(el('span', '', tag));
  const load = actionButton(
    `Load into ${part?.name ?? 'part'}`,
    'Load this patch into the part (Enter or a double-click)',
    part !== undefined,
    'btn primary',
  );
  load.onclick = (): void => hooks.load(row.id);
  const copy = actionButton('Save as…', 'Copy this patch to a new patch in your library', true);
  copy.onclick = (): void =>
    run(ctx, async () => {
      const id = await saveAs(ctx, row, patch, copy);
      if (id !== null) hooks.done(id);
    });
  const renameButton = actionButton(
    'Rename',
    rename === 'song'
      ? "Rename the song's copy; parts playing it follow"
      : 'Rename your library patch',
    rename !== null,
    'btn ghost',
  );
  renameButton.onclick = (): void => {
    if (rename === null) return;
    const back = (): void => {
      form.replaceWith(name);
      renameButton.focus();
    };
    const form = renameForm(ctx, row, rename, hooks, back);
    name.replaceWith(form);
  };
  const deleteButton = actionButton(
    'Delete',
    removal === 'song'
      ? "Remove the song's copy; no part plays it"
      : 'Remove from your library; songs keep their copies',
    removal !== null,
    'btn ghost',
  );
  deleteButton.onclick = (): void =>
    run(ctx, async () => {
      if (removal !== null && (await remove(ctx, row, removal, deleteButton))) hooks.done();
    });
  const inFolder = library.folder !== null && Object.hasOwn(library.entries, row.id);
  const show = actionButton(
    'Show in folder',
    'Name the file in the connected library folder',
    inFolder,
    'btn ghost',
  );
  show.onclick = (): void =>
    ctx.notify(`${row.id}.json — in the library folder (${LIBRARY_FOLDER_PATH})`);
  const primary = el('div', 'pb-actions');
  primary.append(load, copy);
  const manage = el('div', 'pb-actions');
  manage.append(renameButton, deleteButton, show);
  pane.append(
    name,
    el('div', 'hint pb-detail', info.detail),
    tags,
    el('p', 'pb-desc', info.description),
    el('div', 'hint pb-summary', info.summary),
    envelopeSketch(info.envelope),
    primary,
    manage,
    el(
      'p',
      'hint',
      'Built-ins are read-only; Rename and Delete act on your library and song patches. Loading copies the patch into the song.',
    ),
  );
  return pane;
}
