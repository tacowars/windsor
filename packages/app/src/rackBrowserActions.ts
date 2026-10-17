/**
 * The browser's rack actions (windsor#884; record `2026-10-17-racks`
 * decisions 10, 11, 14 and 17): Load into the part as one change behind the
 * two discard guards, Rename, Delete and Export of a rack, over the pure
 * rules of `rackActions.ts` and the writes of `rackLibrary.ts`. The pane
 * (`rackBrowserInfo.ts`) calls these; nothing here draws.
 */
import type { RackEntry } from '@windsor/engine';
import { partAt, serialiseRackFile } from '@windsor/engine';
import type { AppCtx } from './context';
import { withGesture } from './gestureHooks';
import { library } from './libraryModel';
import { openConfirm } from './metadataModal';
import type { PatchLoader } from './presetBrowser';
import { addPartFromRackChange, loadRackChange, rackDifferences, renamedRack } from './rackActions';
import {
  downloadRackFile,
  isRackWritable,
  rackEntry,
  removeRackFile,
  writeRackFile,
} from './rackLibrary';

/** The members a part was edited on since its rack load, as the confirm names them. */
const MEMBER_NAMES = {
  patch: 'patch',
  inserts: 'effects',
  lowCut: 'low cut',
  sequencer: 'sequencer',
};

/**
 * The rack discard guard (decision 11): true when the part's rack, if it has
 * one, is unedited, or the user agrees to lose the edits. The patch's own
 * guard is the loader's and runs after this one.
 */
async function confirmRackEdits(ctx: AppCtx, slot: number, opener?: HTMLElement): Promise<boolean> {
  const part = partAt(ctx.model.doc, slot);
  const rack = part?.rackSource === undefined ? undefined : rackEntry(library, part.rackSource);
  if (!part || !rack) return true;
  const edited = rackDifferences(part, ctx.model.doc.patches?.[part.preset], rack);
  if (edited.length === 0) return true;
  const members = edited.map((member) => MEMBER_NAMES[member]).join(', ');
  return openConfirm({
    title: 'Unsaved rack edits',
    body: `${part.name} differs from the rack "${rack.name}" it was loaded from (${members}). Loading another rack discards those edits; Save rack in the ⋯ menu keeps them.`,
    ok: 'Discard',
    opener: opener ?? null,
  });
}

/**
 * Load rack `id` into the selected part (decision 10) the way a patch pick
 * does: the rack guard, then the patch's guard, then one undo step, then the
 * rail reload, a render (the chain and the sequencer changed) and `focus`.
 */
export function loadRackIntoPart(
  ctx: AppCtx,
  id: string,
  loader: PatchLoader,
  focus: () => void,
  opener?: HTMLElement,
): void {
  const slot = ctx.parts.selected;
  const file = rackEntry(library, id);
  if (!file) return;
  confirmRackEdits(ctx, slot, opener).then(
    (ok) => {
      if (!ok) return;
      loader.guard(() => {
        const loaded = withGesture('Load rack', () => {
          const partial = loadRackChange(
            ctx.model.doc,
            slot,
            { id, file },
            library,
            ctx.autoCopies,
          );
          if (!partial || !ctx.change(partial).ok) return false;
          loader.onPick();
          return true;
        });
        if (!loaded) return;
        ctx.render();
        focus();
      });
    },
    (error: unknown) => ctx.notify(String(error), 'error'),
  );
}

/**
 * Add a part playing rack `id` (decision 12, windsor#885): the new part on
 * the lowest free slot with the rack loaded, one change, then selected and
 * the tab rendered. False when the song is full or the engine refused.
 */
export function addPartFromRack(
  ctx: AppCtx,
  id: string,
  loader: PatchLoader,
  focus: () => void,
): boolean {
  const file = rackEntry(library, id);
  if (!file) return false;
  const slot = withGesture('Add part from rack', () => {
    const preview = (raw: unknown): ReturnType<AppCtx['model']['preview']> =>
      ctx.model.preview(raw);
    const added = addPartFromRackChange(
      ctx.model.doc,
      preview,
      { id, file },
      library,
      ctx.autoCopies,
    );
    if (!added) {
      ctx.notify('The song is full: no part was added.', 'warning');
      return null;
    }
    return ctx.change(added.partial).ok ? added.slot : null;
  });
  if (slot === null) return false;
  ctx.parts.pick(slot);
  loader.onPick();
  ctx.render();
  ctx.notify(`added ${partAt(ctx.model.doc, slot)?.name ?? 'a part'} from the rack "${file.name}"`);
  focus();
  return true;
}

/** Rename a user rack: the file's name and its patch's (decision 6), the id kept. */
export async function renameRack(ctx: AppCtx, entry: RackEntry, name: string): Promise<void> {
  if (!isRackWritable(library, entry.id)) throw new Error(`"${entry.name}" is read-only.`);
  await writeRackFile(library, entry.id, serialiseRackFile(renamedRack(entry, name)));
  ctx.notify(`renamed "${entry.name}" to "${name}"`, 'success');
}

/** Delete a user rack after the confirm; true when it went. */
export async function deleteRack(
  ctx: AppCtx,
  entry: RackEntry,
  opener: HTMLElement,
): Promise<boolean> {
  const where = library.rackFolder
    ? `${entry.id}.json from the library folder`
    : 'it from your racks';
  const ok = await openConfirm({
    title: `Delete "${entry.name}"?`,
    body: `Removes ${where}. Parts loaded from it keep what they play.`,
    ok: 'Delete',
    opener,
  });
  if (!ok) return false;
  await removeRackFile(library, entry.id);
  ctx.notify(`deleted "${entry.name}"`, 'success');
  return true;
}

/** Export a rack: `<id>.json` as the file writes it (decision 17). */
export function exportRack(entry: RackEntry): void {
  downloadRackFile(entry.id, serialiseRackFile(entry));
}
