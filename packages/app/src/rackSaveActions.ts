/**
 * The patch bar's rack entries (windsor#885; record `2026-10-17-racks`
 * decisions 13, 14 and 19): Save as rack… through the metadata modal with
 * its two member boxes, Save rack over the part's rack (a built-in forks to
 * a new id, as Save does for a patch) and Revert rack, which loads the
 * library rack again without the confirm. The pure rules are
 * `rackActions.ts`; the writes `rackLibrary.ts`; the modal `metadataModal.ts`.
 */
import { partAt, serialiseRackFile } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { withGesture } from './gestureHooks';
import { library, writtenText } from './libraryModel';
import { checkLoudness } from './loudnessCheck';
import type { MemberBox } from './metadataModal';
import { openMetadataModal } from './metadataModal';
import { currentMetadata } from './patchActions';
import type { MenuItem } from './patchMenu';
import { slugify, uniqueId } from './patchMetadata';
import type { RackSaveOptions } from './rackActions';
import { loadRackChange, rackDifferences, rackFromPart, saveMembersFor } from './rackActions';
import { rackNameProblem } from './rackBrowserModel';
import { isRackWritable, rackEntry, writeRackFile } from './rackLibrary';
import { KIND_LABELS } from './sequencerConstants';
import { fmtHz } from './consoleFormat';

const SAVE_AS_RACK = {
  title: 'Save as rack…',
  hint: "Saves this part's patch and effects as a new rack in your library. The part keeps playing what it plays and follows the rack.",
};

/** The two boxes for the part on `slot`: their defaults by decision 13, their values beside them. */
function memberBoxes(ctx: AppCtx, slot: number): MemberBox[] {
  const part = partAt(ctx.model.doc, slot);
  if (!part) return [];
  const defaults = saveMembersFor(part);
  return [
    {
      key: 'lowCut',
      label: 'Include low cut',
      value: `${fmtHz(part.strip.lowCut)} Hz`,
      note: "Checked when the part's low cut is above its floor. Loading the rack then sets the part's low cut; unchecked, the rack leaves it alone.",
      checked: defaults.lowCut,
    },
    {
      key: 'sequencer',
      label: 'Include sequencer',
      value: KIND_LABELS[part.sequencer.kind],
      note: "Checked when the part's sequencer is not None. The pattern is saved without its seed; loading the rack sets the part's sequencer and treats its regions as a kind change does.",
      checked: defaults.sequencer,
    },
  ];
}

/** Write `options` as the rack `id` from the part on `slot`, and link the part to it while it is still the one saved from. */
async function writeRack(
  ctx: AppCtx,
  slot: number,
  id: string,
  options: RackSaveOptions,
): Promise<{ id: string; linked: boolean }> {
  const file = rackFromPart(ctx.model.doc, slot, options, new Set(Object.keys(library.entries)));
  if (!file) throw new Error('This part has no patch to save as a rack.');
  // Pinned before the write, as Save pins them: another song opened, or the
  // slot moved on, meanwhile gets no link. The file is still written.
  const own = partAt(ctx.model.doc, slot)?.preset;
  const song = ctx.model.openings;
  await writeRackFile(library, id, serialiseRackFile(file));
  const after = partAt(ctx.model.doc, slot);
  const still = ctx.model.openings === song && after !== undefined && after.preset === own;
  if (still && after.rackSource !== id) ctx.change(partChange(slot, { rackSource: id }));
  return { id, linked: still };
}

/** Save as rack…: the modal, then the write under a fresh id, then the link (decision 13). */
async function runSaveAsRack(ctx: AppCtx, opener: HTMLElement, refresh: () => void): Promise<void> {
  const slot = ctx.parts.selected;
  const scope = { ctx, library, slot };
  const meta = await openMetadataModal(
    {
      ...SAVE_AS_RACK,
      initial: currentMetadata(scope, ctx.parts.patch),
      entries: library.entries,
      id: (name) => uniqueId(slugify(name), Object.keys(library.racks)),
      // The name is a rack's: the patch library's names do not count, another rack's does.
      nameProblem: (name) => rackNameProblem(name, library.racks),
      members: memberBoxes(ctx, slot),
      loudness: checkLoudness(ctx.parts.patch),
      opener,
    },
    ctx.parts.patch.volume,
  );
  if (!meta) return;
  const members = meta.members ?? saveMembersFor(partAt(ctx.model.doc, slot)!);
  const options: RackSaveOptions = {
    ...meta,
    lowCut: members['lowCut'] ?? false,
    sequencer: members['sequencer'] ?? false,
  };
  const { id, linked } = await writeRack(
    ctx,
    slot,
    uniqueId(slugify(meta.name), Object.keys(library.racks)),
    options,
  );
  const written = writtenText(library, id).replace('saved', 'saved rack');
  ctx.notify(
    linked
      ? `${written} — this part follows it`
      : `${written} — the part moved on meanwhile, so it is not linked`,
    linked ? 'success' : 'warning',
  );
  refresh();
}

/** Save rack: over the part's user rack with the rack's own metadata and members, or a built-in forked to a new id. */
async function runSaveRack(ctx: AppCtx, refresh: () => void): Promise<void> {
  const slot = ctx.parts.selected;
  const part = partAt(ctx.model.doc, slot);
  const rack = part?.rackSource === undefined ? undefined : rackEntry(library, part.rackSource);
  if (!part || !rack) return;
  const options: RackSaveOptions = {
    name: rack.name,
    category: rack.category,
    tags: [...rack.tags],
    description: rack.description,
    lowCut: rack.lowCut !== undefined,
    sequencer: rack.sequencer !== undefined,
  };
  const forks = !isRackWritable(library, rack.id);
  const id = forks ? uniqueId(slugify(rack.name), Object.keys(library.racks)) : rack.id;
  const { linked } = await writeRack(ctx, slot, id, options);
  const follows = linked
    ? 'this part follows it'
    : 'the part moved on meanwhile, so it is not linked';
  ctx.notify(
    forks
      ? `built-in racks stay as they are: saved your "${rack.name}" as ${id}; ${follows}`
      : `saved rack "${rack.name}"`,
    linked ? 'success' : 'warning',
  );
  refresh();
}

/** Revert rack: the library rack loaded again (decision 10), no confirm. */
function runRevertRack(ctx: AppCtx, refresh: () => void): void {
  const slot = ctx.parts.selected;
  const part = partAt(ctx.model.doc, slot);
  const file = part?.rackSource === undefined ? undefined : rackEntry(library, part.rackSource);
  if (!part || !file) return;
  const ok = withGesture('Revert rack', () => {
    const partial = loadRackChange(
      ctx.model.doc,
      slot,
      { id: file.id, file },
      library,
      ctx.autoCopies,
    );
    return partial !== null && ctx.change(partial).ok;
  });
  if (!ok) return;
  refresh();
  ctx.render();
  ctx.notify(`"${file.name}" loaded again from the library`, 'success');
}

/** A menu entry whose action reports its failure as an error toast. */
function entry(
  ctx: AppCtx,
  label: string,
  title: string,
  enabled: boolean,
  run: (opener: HTMLElement) => void | Promise<void>,
): MenuItem {
  return {
    kind: 'action',
    label,
    title,
    enabled,
    run: (opener) =>
      Promise.resolve(run(opener)).catch((error: unknown) => ctx.notify(String(error), 'error')),
  };
}

/** The ⋯ menu's rack group (decision 19): Save as rack… always; Save rack and Revert rack while the part has a rack. */
export function rackMenuEntries(ctx: AppCtx, refresh: () => void): MenuItem[] {
  const slot = ctx.parts.selected;
  const part = partAt(ctx.model.doc, slot);
  const patch = part && ctx.model.doc.patches?.[part.preset];
  const items = [
    entry(
      ctx,
      'Save as rack…',
      "Save this part's patch and effects as a new rack in your library",
      part !== undefined && patch !== undefined,
      (opener) => runSaveAsRack(ctx, opener, refresh),
    ),
  ];
  const rack = part?.rackSource === undefined ? undefined : rackEntry(library, part.rackSource);
  if (!part || !rack) return items;
  const edited = rackDifferences(part, patch, rack).length > 0;
  return [
    ...items,
    entry(
      ctx,
      'Save rack',
      isRackWritable(library, rack.id)
        ? 'Save over this rack'
        : 'Built-in racks stay read-only, so Save forks this one to a new id',
      edited,
      () => runSaveRack(ctx, refresh),
    ),
    entry(
      ctx,
      'Revert rack',
      "Load the library rack again; the part's edits to it go",
      edited,
      () => runRevertRack(ctx, refresh),
    ),
  ];
}
