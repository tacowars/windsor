/**
 * The patch bar's library actions (#563; the bar, windsor#521): Save, Save
 * as… (the old Copy to new) and Init as buttons, then Delete and the folder
 * grant (the developer mode) for the ⋯ menu, and the unsaved dot, over
 * `patchActions.ts` and the modals. Writes go to the user's library in this
 * browser (`2026-09-27-user-library-in-indexeddb`), or to the folder while
 * one is connected.
 * The actions are pure and tested; this wires them to buttons and reports
 * the patch files a library read refused as a warning toast.
 */
import { partAt } from '@windsor/engine';
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
  awaitUserLibrary,
  connectLibrary,
  createProblemReporter,
  disconnectLibrary,
  loadPageLibrary,
  library,
  refreshLibrary,
} from './libraryModel';
import type { LibraryModel, SettleUserLibrary } from './libraryModel';
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
import type { MenuItem } from './patchMenu';
import { SEPARATOR } from './patchMenu';
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
 * folder whose grant still stands. A song opening meanwhile waits for all
 * of it (`libraryLoaded`).
 */
export function bootLibrary(
  user: PatchFolder | null,
  settle: SettleUserLibrary = awaitUserLibrary,
): Promise<void> {
  const load = loadBootLibrary(user);
  settle(load);
  return load;
}

async function loadBootLibrary(user: PatchFolder | null): Promise<void> {
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

/** The patch box's unsaved dot; the Parts tab's editor calls this after every push. */
export function syncModifiedMarker(ctx: AppCtx): void {
  const marker = document.getElementById('patchModified');
  if (!marker) return;
  marker.hidden = !isModified(scopeFor(ctx), ctx.parts.patch);
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

/** Pended at once (windsor#669): a song opening while the handle is forgotten waits for the page library. */
function forgetFolder(ctx: AppCtx): Promise<void> {
  const load = forgetAndDisconnect(ctx);
  awaitUserLibrary(load);
  return load;
}

async function forgetAndDisconnect(ctx: AppCtx): Promise<void> {
  await forgetHandle();
  await disconnectLibrary(library);
  remembered = null;
  ctx.notify('library folder forgotten — Save writes to your library in this browser again');
  ctx.render();
}

const loudnessFor = (ctx: AppCtx): Promise<LoudnessResult> => checkLoudness(ctx.parts.patch);

/** The save toast, naming where the write went. */
export function writtenText(model: LibraryModel, id: string): string {
  if (model.folder) return `wrote ${id}.json to the folder`;
  if (model.user) return `saved ${id} to your library`;
  return `downloaded ${id}.json`;
}

interface CopyWording {
  title: string;
  hint: string;
}

const COPY_WORDING: CopyWording = {
  title: 'Save as…',
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
  const named = partAt(ctx.model.doc, scope.slot)?.name;
  const { id, switched } = await copyToNew({ ...scope, working: ctx.parts.patch, meta });
  // Skipped when another song opened or the slot moved on (windsor#677): only the file was written.
  const written = writtenText(library, id);
  ctx.notify(switched ? `${written} — this part now plays it` : written, 'success');
  refresh();
  // A generic part just took its patch's name (windsor#103): the part picker shows it too.
  if (switched && partAt(ctx.model.doc, scope.slot)?.name !== named) ctx.render();
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
  ctx.notify('Init loaded — Save as… keeps it; loading another patch discards it');
  refresh();
}

function button(label: string, title: string, enabled: boolean): HTMLButtonElement {
  const node = el('button', 'btn', label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.disabled = !enabled;
  return node;
}

type LibraryAction = (ctx: AppCtx, opener: HTMLElement, refresh: () => void) => Promise<void>;

/** Runs an action and reports its failure as an error toast. */
function runner(ctx: AppCtx, refresh: () => void) {
  return (action: LibraryAction, opener: HTMLElement): Promise<void> =>
    action(ctx, opener, refresh).catch((error: unknown) => ctx.notify(String(error), 'error'));
}

/** A menu entry whose async action reports its failure as an error toast. */
function menuAction(
  ctx: AppCtx,
  label: string,
  title: string,
  action: () => Promise<void>,
): MenuItem {
  return {
    kind: 'action',
    label,
    title,
    enabled: true,
    // The menu restores focus once the returned promise settles (windsor#537).
    run: () => action().catch((error: unknown) => ctx.notify(String(error), 'error')),
  };
}

/**
 * The bar's Save, Save as… and Init (windsor#521 decision 2); `refresh`
 * reloads the working patch and rebuilds the bar. Save as… is the old Copy to
 * new. Also syncs the unsaved dot and reports a refused library read.
 */
export function libraryButtons(ctx: AppCtx, refresh: () => void): HTMLButtonElement[] {
  const scope = scopeFor(ctx);
  const origin = patchOrigin(scope);
  const run = runner(ctx, refresh);
  const save = button(
    'Save',
    saveForks(scope)
      ? 'Save your edit as a new patch; built-ins stay read-only'
      : 'Save over this patch',
    canSave(origin),
  );
  save.onclick = (): void => void run(runSave, save);
  const copy = button('Save as…', 'Save as a new patch in your library', canCopy(origin));
  copy.onclick = (): void => void run(runCopy, copy);
  const init = button('Init', 'A fresh starting patch; not in the library until Save as…', true);
  init.onclick = (): void => void run(runInit, init);
  queueMicrotask(() => {
    syncModifiedMarker(ctx);
    reportLibraryProblems(ctx);
  });
  return [save, copy, init];
}

/** The folder grant (the developer mode): connect or change, then re-read and forget; the ⋯ menu and the browser's header. */
export function libraryFolderEntries(ctx: AppCtx): MenuItem[] {
  if (!folderApiAvailable()) {
    if (library.user) return [];
    const note = el('p', 'hint', 'This browser cannot store patches: Save downloads <id>.json.');
    return [{ kind: 'node', node: note }];
  }
  let label = 'Library folder…';
  if (library.folder) label = 'Change folder…';
  else if (remembered) label = 'Re-grant folder';
  const items = [
    menuAction(
      ctx,
      label,
      `Developer mode: grant access to ${LIBRARY_FOLDER_PATH} in a Windsor checkout so Save writes the file there`,
      () => connectFolder(ctx),
    ),
  ];
  if (!library.folder) return items;
  return [
    ...items,
    menuAction(ctx, 'Re-read folder', 'Read the folder again', async () => {
      await refreshLibrary(library);
      // An explicit re-read says a refusal again, even one dismissed and unchanged.
      reportLibraryProblems(ctx, true);
      ctx.render();
    }),
    menuAction(ctx, 'Forget folder', 'Back to your library in this browser', () =>
      forgetFolder(ctx),
    ),
  ];
}

/** The ⋯ menu's library entries: Delete, the folder actions, and any old-format patches. */
export function libraryMenuEntries(ctx: AppCtx, refresh: () => void): MenuItem[] {
  const origin = patchOrigin(scopeFor(ctx));
  const run = runner(ctx, refresh);
  const items: MenuItem[] = [
    {
      kind: 'action',
      label: 'Delete',
      title: library.folder
        ? 'Remove the file from the library folder'
        : 'Remove from your library; built-ins stay',
      enabled: canDelete(origin, library),
      run: (opener) => run(runDelete, opener),
    },
  ];
  const folder = libraryFolderEntries(ctx);
  if (folder.length) items.push(SEPARATOR, ...folder);
  if (library.oldFormat.length)
    items.push(SEPARATOR, { kind: 'node', node: oldFormatList(ctx, library, refresh) });
  return items;
}
