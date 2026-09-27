/**
 * The Parts tab's library row (#563): Init, Save, Copy to new, Delete, the
 * folder grant and the unsaved marker, over `patchActions.ts` and the modals.
 * The actions are pure and tested; this wires them to buttons and keeps the
 * header's library-mode line current.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { LIBRARY_FOLDER_PATH } from './libraryConstants';
import type { ChromeDirectoryHandle } from './libraryFolder';
import {
  folderApiAvailable,
  forgetHandle,
  pickDirectory,
  queryGrant,
  recallHandle,
  rememberHandle,
  requestGrant,
  wrapDirectoryHandle,
} from './libraryFolder';
import {
  connectLibrary,
  disconnectLibrary,
  library,
  libraryModeText,
  refreshLibrary,
} from './libraryModel';
import type { LoudnessResult } from './loudnessCheck';
import { checkLoudness } from './loudnessCheck';
import { openConfirm, openMetadataModal } from './metadataModal';
import type { PatchScope } from './patchActions';
import {
  canCopy,
  canDelete,
  canSave,
  copyPrefill,
  copyToNew,
  currentMetadata,
  deletePatch,
  deleteRefusal,
  discardEdits,
  initPatch,
  isModified,
  patchOrigin,
  savePatch,
  unsavedQuestion,
} from './patchActions';
import { slugify, uniqueId } from './patchMetadata';

/** A handle recalled from IndexedDB whose grant the browser dropped; the button re-requests it. */
let remembered: ChromeDirectoryHandle | null = null;

const scopeFor = (ctx: AppCtx): PatchScope => ({ ctx, library, slot: ctx.parts.selected });

/** The header's account of the mode, and the folder read's problems if any. */
export function syncLibraryMode(): void {
  const line = document.getElementById('libraryMode');
  if (!line) return;
  const problems = library.problems.length ? ` · ${library.problems.length} file(s) refused` : '';
  line.textContent = libraryModeText(library) + problems;
  line.title = library.problems.join('\n');
}

/** At boot: reconnect a remembered folder whose grant still stands. */
export async function bootLibrary(): Promise<void> {
  if (!folderApiAvailable()) return;
  const handle = await recallHandle();
  if (!handle) return;
  if ((await queryGrant(handle)) === 'granted') {
    await connectLibrary(library, wrapDirectoryHandle(handle));
  } else {
    remembered = handle;
  }
}

/** The unsaved-changes guard: resolves true when loading over the working patch may go ahead. */
export async function confirmUnsaved(ctx: AppCtx, opener?: HTMLElement): Promise<boolean> {
  const scope = scopeFor(ctx);
  const question = unsavedQuestion(scope, ctx.parts.patch);
  if (question === null) return true;
  const ok = await openConfirm({
    title: 'Unsaved changes',
    body: question,
    ok: 'Discard',
    opener: opener ?? null,
  });
  if (!ok) return false;
  // Really discard: the document copy back to the baseline, so re-selecting
  // the same preset does not find the edits still there.
  const restored = discardEdits(scope);
  if (restored) ctx.parts.patch = restored;
  return true;
}

/** The marker beside the buttons; the Parts tab's editor calls this after every push. */
export function syncModifiedMarker(ctx: AppCtx): void {
  const marker = document.getElementById('patchModified');
  if (!marker) return;
  const modified = isModified(scopeFor(ctx), ctx.parts.patch);
  marker.textContent = modified ? '● unsaved edits' : '';
  marker.hidden = !modified;
}

async function connectFolder(ctx: AppCtx): Promise<void> {
  let handle = remembered;
  if (handle && (await requestGrant(handle)) !== 'granted') handle = null;
  if (!handle) {
    handle = await pickDirectory();
    if (!handle) return;
    await rememberHandle(handle);
  }
  remembered = null;
  await connectLibrary(library, wrapDirectoryHandle(handle));
  ctx.status(`library folder "${handle.name}" connected — Save writes to it`);
  ctx.render();
}

async function forgetFolder(ctx: AppCtx): Promise<void> {
  await forgetHandle();
  disconnectLibrary(library);
  remembered = null;
  ctx.status('library folder forgotten — back on the page library; Save downloads');
  ctx.render();
}

const loudnessFor = (ctx: AppCtx): Promise<LoudnessResult> => checkLoudness(ctx.parts.patch);

async function runSave(ctx: AppCtx, opener: HTMLElement, refresh: () => void): Promise<void> {
  const scope = scopeFor(ctx);
  const origin = patchOrigin(scope);
  if (origin.kind !== 'library') return;
  const meta = await openMetadataModal(
    {
      title: `Save over ${origin.id}.json`,
      hint: 'Writes the working patch over its library id; the open song copy follows.',
      initial: currentMetadata(scope, ctx.parts.patch),
      entries: library.entries,
      id: origin.id,
      ownId: origin.id,
      loudness: loudnessFor(ctx),
      opener,
    },
    ctx.parts.patch.volume,
  );
  if (!meta) return;
  const id = await savePatch({ ...scope, working: ctx.parts.patch, meta });
  ctx.status(`saved ${id}.json — run the sweep before committing`);
  refresh();
}

async function runCopy(ctx: AppCtx, opener: HTMLElement, refresh: () => void): Promise<void> {
  const scope = scopeFor(ctx);
  const taken = [...Object.keys(library.entries), ...Object.keys(ctx.model.doc.patches ?? {})];
  const meta = await openMetadataModal(
    {
      title: 'Copy to new',
      hint: 'Writes the working patch as a new library file and switches this part to it.',
      initial: copyPrefill(scope, ctx.parts.patch),
      entries: library.entries,
      id: (name) => uniqueId(slugify(name), taken),
      loudness: loudnessFor(ctx),
      opener,
    },
    ctx.parts.patch.volume,
  );
  if (!meta) return;
  const id = await copyToNew({ ...scope, working: ctx.parts.patch, meta });
  ctx.status(`wrote ${id}.json — this part now plays it; run the sweep before committing`);
  refresh();
}

async function runDelete(ctx: AppCtx, opener: HTMLElement, refresh: () => void): Promise<void> {
  const origin = patchOrigin(scopeFor(ctx));
  if (origin.kind !== 'library') return;
  const refusal = deleteRefusal(origin.id);
  if (refusal) return ctx.status(`delete refused: ${refusal}`);
  const name = library.entries[origin.id]?.name ?? origin.id;
  const ok = await openConfirm({
    title: `Delete "${name}"?`,
    body: `Removes ${origin.id}.json from the library folder. Songs keep their own copies; this part keeps playing the document's copy.`,
    ok: 'Delete',
    opener,
  });
  if (!ok) return;
  await deletePatch(library, origin.id);
  ctx.status(`deleted ${origin.id}.json`);
  refresh();
}

async function runInit(ctx: AppCtx, opener: HTMLElement, refresh: () => void): Promise<void> {
  if (!(await confirmUnsaved(ctx, opener))) return;
  initPatch(scopeFor(ctx));
  ctx.status('Init loaded — Copy to new keeps it; loading another patch discards it');
  refresh();
}

function button(label: string, title: string, enabled: boolean): HTMLButtonElement {
  const node = el('button', 'btn', label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.disabled = !enabled;
  return node;
}

/** The row under the preset browser; `refresh` reloads the working patch and rebuilds the rail. */
// eslint-disable-next-line max-lines-per-function -- one row of five buttons, each wired to its action
export function libraryActions(ctx: AppCtx, refresh: () => void): HTMLElement {
  const box = el('div', 'library-row');
  const scope = scopeFor(ctx);
  const origin = patchOrigin(scope);
  const run = (
    action: (ctx: AppCtx, opener: HTMLElement, refresh: () => void) => Promise<void>,
    opener: HTMLElement,
  ): void => {
    action(ctx, opener, refresh).catch((error: unknown) => ctx.status(String(error)));
  };
  const init = button('Init', 'makePatch() defaults; not in the library until Copy to new', true);
  init.onclick = (): void => run(runInit, init);
  const save = button('Save', 'Write over this library id', canSave(origin));
  save.onclick = (): void => run(runSave, save);
  const copy = button('Copy to new', 'Save as a new library patch', canCopy(origin));
  copy.onclick = (): void => run(runCopy, copy);
  const del = button(
    'Delete',
    library.folder ? 'Remove the file from the library folder' : 'Connect the library folder first',
    canDelete(origin, library),
  );
  del.onclick = (): void => run(runDelete, del);
  const marker = el('span', 'status hot');
  marker.id = 'patchModified';
  box.append(init, save, copy, del, marker);

  const folderRow = el('div', 'bar-row');
  if (folderApiAvailable()) {
    let label = 'Library folder…';
    if (library.folder) label = 'Change folder…';
    else if (remembered) label = 'Re-grant folder';
    const connect = button(
      label,
      `Grant access to ${LIBRARY_FOLDER_PATH} so Save writes the file`,
      true,
    );
    connect.onclick = (): void => {
      connectFolder(ctx).catch((error: unknown) => ctx.status(String(error)));
    };
    folderRow.appendChild(connect);
    if (library.folder) {
      const forget = button('Forget folder', 'Back to the library baked into the page', true);
      forget.onclick = (): void => {
        forgetFolder(ctx).catch((error: unknown) => ctx.status(String(error)));
      };
      const reread = button('Re-read folder', 'Read the folder again', true);
      reread.onclick = (): void => {
        refreshLibrary(library)
          .then(() => ctx.render())
          .catch((error: unknown) => ctx.status(String(error)));
      };
      folderRow.append(reread, forget);
    }
  } else {
    folderRow.appendChild(
      el('p', 'hint', 'No File System Access API here: Save downloads <id>.json.'),
    );
  }
  box.appendChild(folderRow);
  queueMicrotask(() => {
    syncModifiedMarker(ctx);
    syncLibraryMode();
  });
  return box;
}
