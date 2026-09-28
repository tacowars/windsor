/**
 * The Parts tab's library row (#563): Init, Save, Copy to new, Delete, the
 * folder grant (the developer mode) and the unsaved marker, over
 * `patchActions.ts` and the modals. Writes go to the user's library in this
 * browser (`2026-09-27-user-library-in-indexeddb`), or to the folder while
 * one is connected.
 * The actions are pure and tested; this wires them to buttons and reports
 * the patch files a library read refused as a warning toast.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { LIBRARY_FOLDER_PATH } from './libraryConstants';
import type { ChromeDirectoryHandle, PatchFolder } from './libraryFolder';
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
  createProblemReporter,
  disconnectLibrary,
  loadPageLibrary,
  library,
  refreshLibrary,
} from './libraryModel';
import type { LibraryModel } from './libraryModel';
import type { LoudnessResult } from './loudnessCheck';
import { checkLoudness } from './loudnessCheck';
import { openConfirm, openMetadataModal } from './metadataModal';
import { oldFormatList } from './oldFormatPatches';
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
  saveForks,
  savePatch,
  unsavedQuestion,
} from './patchActions';
import { slugify, uniqueId } from './patchMetadata';

/** A handle recalled from IndexedDB whose grant the browser dropped; the button re-requests it. */
let remembered: ChromeDirectoryHandle | null = null;

const scopeFor = (ctx: AppCtx): PatchScope => ({ ctx, library, slot: ctx.parts.selected });

/** The refusals last reported, so a re-render does not repeat the same toast. */
const reportProblems = createProblemReporter();

/** Tells the user which patch files the last library read refused (`createProblemReporter`). */
export function reportLibraryProblems(ctx: AppCtx, force = false): void {
  reportProblems(library, (message, tone) => ctx.notify(message, tone), force);
}

/**
 * At boot: attach the user's library (null where the browser has no
 * IndexedDB), load the built-ins beside it, then reconnect a remembered
 * folder whose grant still stands.
 */
export async function bootLibrary(user: PatchFolder | null): Promise<void> {
  library.user = user;
  await loadPageLibrary(library);
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
  ctx.notify(`library folder "${handle.name}" connected — Save writes to it`, 'success');
  ctx.render();
}

async function forgetFolder(ctx: AppCtx): Promise<void> {
  await forgetHandle();
  await disconnectLibrary(library);
  remembered = null;
  ctx.notify('library folder forgotten — Save writes to your library in this browser again');
  ctx.render();
}

const loudnessFor = (ctx: AppCtx): Promise<LoudnessResult> => checkLoudness(ctx.parts.patch);

/** The save toast, naming where the write went. */
function writtenText(model: LibraryModel, id: string): string {
  if (model.folder) return `wrote ${id}.json to the folder`;
  if (model.user) return `saved ${id} to your library`;
  return `downloaded ${id}.json`;
}

interface CopyWording {
  title: string;
  hint: string;
}

const COPY_WORDING: CopyWording = {
  title: 'Copy to new',
  hint: 'Saves the working patch as a new patch in your library and switches this part to it.',
};

const forkWording = (name: string): CopyWording => ({
  title: `Save your own "${name}"`,
  hint: 'Built-in patches stay as they are: this saves your edit as a new patch in your library and switches this part to it.',
});

async function runSave(ctx: AppCtx, opener: HTMLElement, refresh: () => void): Promise<void> {
  const scope = scopeFor(ctx);
  const origin = patchOrigin(scope);
  if (origin.kind !== 'library') return;
  if (saveForks(scope)) {
    const name = library.entries[origin.id]?.name ?? origin.id;
    return runCopy(ctx, opener, refresh, forkWording(name));
  }
  // Folder mode names the file it overwrites; a visitor's patch is a record, named as they know it.
  const name = library.entries[origin.id]?.name ?? origin.id;
  const meta = await openMetadataModal(
    {
      title: library.folder ? `Save over ${origin.id}.json` : `Save over "${name}"`,
      hint: library.folder
        ? 'Writes the working patch over its library id; the open song copy follows.'
        : "Saves your edits over this patch in your library. The song's copy updates too.",
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
  ctx.notify(writtenText(library, id), 'success');
  refresh();
}

async function runCopy(
  ctx: AppCtx,
  opener: HTMLElement,
  refresh: () => void,
  wording: CopyWording = COPY_WORDING,
): Promise<void> {
  const scope = scopeFor(ctx);
  const taken = [...Object.keys(library.entries), ...Object.keys(ctx.model.doc.patches ?? {})];
  const meta = await openMetadataModal(
    {
      ...wording,
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
  ctx.notify(`${writtenText(library, id)} — this part now plays it`, 'success');
  refresh();
}

async function runDelete(ctx: AppCtx, opener: HTMLElement, refresh: () => void): Promise<void> {
  const origin = patchOrigin(scopeFor(ctx));
  if (origin.kind !== 'library') return;
  const refusal = deleteRefusal(origin.id);
  if (refusal) return ctx.notify(`delete refused: ${refusal}`, 'warning');
  const name = library.entries[origin.id]?.name ?? origin.id;
  const ok = await openConfirm({
    title: `Delete "${name}"?`,
    body: `Removes ${library.folder ? `${origin.id}.json from the library folder` : 'it from your library'}. Songs keep their own copies; this part keeps playing the song's copy.`,
    ok: 'Delete',
    opener,
  });
  if (!ok) return;
  await deletePatch(library, origin.id);
  ctx.notify(
    library.folder ? `deleted ${origin.id}.json` : `deleted "${origin.id}" from your library`,
    'success',
  );
  refresh();
}

async function runInit(ctx: AppCtx, opener: HTMLElement, refresh: () => void): Promise<void> {
  if (!(await confirmUnsaved(ctx, opener))) return;
  initPatch(scopeFor(ctx));
  ctx.notify('Init loaded — Copy to new keeps it; loading another patch discards it');
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
    action(ctx, opener, refresh).catch((error: unknown) => ctx.notify(String(error), 'error'));
  };
  const init = button('Init', 'makePatch() defaults; not in the library until Copy to new', true);
  init.onclick = (): void => run(runInit, init);
  const save = button(
    'Save',
    saveForks(scope)
      ? 'Save your edit as a new patch; built-ins stay read-only'
      : 'Save over this patch',
    canSave(origin),
  );
  save.onclick = (): void => run(runSave, save);
  const copy = button('Copy to new', 'Save as a new patch in your library', canCopy(origin));
  copy.onclick = (): void => run(runCopy, copy);
  const del = button(
    'Delete',
    library.folder
      ? 'Remove the file from the library folder'
      : 'Remove from your library; built-ins stay',
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
      `Developer mode: grant access to ${LIBRARY_FOLDER_PATH} in a Windsor checkout so Save writes the file there`,
      true,
    );
    connect.onclick = (): void => {
      connectFolder(ctx).catch((error: unknown) => ctx.notify(String(error), 'error'));
    };
    folderRow.appendChild(connect);
    if (library.folder) {
      const forget = button('Forget folder', 'Back to your library in this browser', true);
      forget.onclick = (): void => {
        forgetFolder(ctx).catch((error: unknown) => ctx.notify(String(error), 'error'));
      };
      const reread = button('Re-read folder', 'Read the folder again', true);
      reread.onclick = (): void => {
        refreshLibrary(library)
          .then(() => {
            // An explicit re-read says a refusal again, even one dismissed and unchanged.
            reportLibraryProblems(ctx, true);
            ctx.render();
          })
          .catch((error: unknown) => ctx.notify(String(error), 'error'));
      };
      folderRow.append(reread, forget);
    }
  } else if (!library.user) {
    folderRow.appendChild(
      el('p', 'hint', 'This browser cannot store patches: Save downloads <id>.json.'),
    );
  }
  box.appendChild(folderRow);
  box.appendChild(oldFormatList(ctx, library, refresh));
  queueMicrotask(() => {
    syncModifiedMarker(ctx);
    reportLibraryProblems(ctx);
  });
  return box;
}
