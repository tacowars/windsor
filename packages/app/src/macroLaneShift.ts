/**
 * Lanes follow their macro (windsor#561 fix round 2, tacowars's decision on
 * PR #565). A song lane names a macro by its row, `voice.macros.<j>.value`,
 * and a step lane by `macros.<j>.value`, so removing macro `i` from a patch
 * would leave every later macro's lanes on the macro before it. The removal
 * therefore deletes the lanes on `macros.<i>.value` and moves each lane on
 * `macros.<j>.value`, `j > i`, to `macros.<j − 1>.value`, in the same edit
 * as the patch's, so one undo step restores both.
 *
 * It reaches every part whose `preset` is the patch (the patch is one
 * snapshot every such part plays): its song lanes (`automation`), its
 * sequencer's step lanes (`lanes` on a grid, arp, bass or figure,
 * `modLanes` on a Euclid), and the step lanes of each region's own pattern.
 * `macroRemovalParts` is pure over the document; `removeMacroAndItsLanes`
 * commits it with the patch's edit. Every macro edit the card commits
 * (`commitMacros`, and the removal) puts the other tabs out of date.
 */
import type {
  ArrangementDocument,
  AutomationLane,
  DocumentPart,
  DeepPartial,
  Macro,
  PartRegion,
  PartsPartial,
  RegionPattern,
  StepModLane,
  VoiceTargetPath,
} from '@windsor/engine';
import { macroIndexOf, voicePathOf, voiceTargetId } from '@windsor/engine';
import { macroValuePath, removeMacro } from './macroModel';
import type { PatchEditor } from './partsSession';

/**
 * Where the voice target at `path` goes when macro `removed` leaves: null
 * for the removed macro's row, the row before for a later macro's, and
 * `path` itself for any other target.
 */
export function shiftedMacroPath(path: string, removed: number): string | null {
  const index = macroIndexOf(path);
  if (index < removed) return path;
  return index === removed ? null : macroValuePath(index - 1);
}

/**
 * `lanes` with each lane's target (`pathOf`, undefined for one that is not a
 * voice target) shifted, a removed one dropped; undefined when none moved.
 */
function shiftedLanes<L>(
  lanes: readonly L[],
  removed: number,
  pathOf: (lane: L) => string | undefined,
  retarget: (lane: L, path: string) => L,
): L[] | undefined {
  let moved = false;
  const out: L[] = [];
  for (const lane of lanes) {
    const from = pathOf(lane);
    const to = from === undefined ? from : shiftedMacroPath(from, removed);
    if (to === from) {
      out.push(lane);
      continue;
    }
    moved = true;
    if (to !== null && to !== undefined) out.push(retarget(lane, to));
  }
  return moved ? out : undefined;
}

const songLanes = (lanes: readonly AutomationLane[], removed: number) =>
  shiftedLanes(
    lanes,
    removed,
    (lane) => voicePathOf(lane.target),
    (lane, path) => ({
      ...lane,
      target: voiceTargetId(path),
    }),
  );

const stepLanes = (lanes: readonly StepModLane[], removed: number) =>
  shiftedLanes(
    lanes,
    removed,
    (lane) => lane.param,
    (lane, path) => ({
      ...lane,
      param: path as VoiceTargetPath,
    }),
  );

/** The step lanes `spec` carries and the key it keeps them under: `modLanes` on a Euclid, `lanes` on a grid, arp, bass or figure. */
function stepLanesOf(
  spec: RegionPattern,
): { key: StepLaneKey; lanes: readonly StepModLane[] } | undefined {
  if (spec.kind === 'euclidean') return { key: 'modLanes', lanes: spec.modLanes ?? [] };
  if (spec.kind === 'chord' || spec.kind === 'none') return undefined;
  return { key: 'lanes', lanes: spec.lanes };
}

type StepLaneKey = 'lanes' | 'modLanes';

/**
 * A sequencer's (or a region pattern's) step lanes after the removal, under
 * its kind's key, or undefined when none moved. A Euclid left with no lanes
 * carries none, as the Euclid's own lane edit leaves it.
 */
function stepLaneChange(
  spec: RegionPattern,
  removed: number,
): Partial<Record<StepLaneKey, StepModLane[] | undefined>> | undefined {
  const held = stepLanesOf(spec);
  const next = held && stepLanes(held.lanes, removed);
  if (!held || !next) return undefined;
  return { [held.key]: held.key === 'modLanes' && next.length === 0 ? undefined : next };
}

/** `regions` with each own pattern's step lanes shifted; undefined when none moved. */
function shiftedRegions(regions: readonly PartRegion[], removed: number): PartRegion[] | undefined {
  let moved = false;
  const out = regions.map((region) => {
    const change = region.pattern && stepLaneChange(region.pattern, removed);
    if (!region.pattern || !change) return region;
    moved = true;
    return { ...region, pattern: { ...region.pattern, ...change } as RegionPattern };
  });
  return moved ? out : undefined;
}

/** What the removal changes on `part`, or undefined for a part with no lane on a moved macro. */
function partChange(part: DocumentPart, removed: number): DeepPartial<DocumentPart> | undefined {
  const automation = songLanes(part.automation ?? [], removed);
  const sequencer = stepLaneChange(part.sequencer, removed);
  const regions = shiftedRegions(part.regions, removed);
  if (!automation && !sequencer && !regions) return undefined;
  return {
    ...(automation && { automation }),
    ...(sequencer && { sequencer: sequencer as DeepPartial<DocumentPart['sequencer']> }),
    ...(regions && { regions }),
  };
}

/**
 * The parts partial removing macro `removed` from the patch `preset` makes
 * (see the file's head): each part playing `preset` whose lanes moved, by
 * slot, and nothing for the others. Commit it with the patch's own edit.
 */
export function macroRemovalParts(
  doc: ArrangementDocument,
  preset: string,
  removed: number,
): PartsPartial<DocumentPart> {
  const parts: Record<number, DeepPartial<DocumentPart>> = {};
  for (const part of doc.parts) {
    if (part.preset !== preset) continue;
    const change = partChange(part, removed);
    if (change) parts[part.slot] = change;
  }
  return parts;
}

/**
 * Write `next` as the editor's macros and push it as an edit the Song tab
 * draws (fix round 3): a macro's name titles its lanes and its mappings
 * decide what the lane picker offers, so the other tabs go out of date. An
 * editor without `pushShared` (a test's) pushes it plainly.
 */
export function commitMacros(editor: PatchEditor, next: Macro[]): void {
  editor.patch.macros = next;
  if (editor.pushShared) editor.pushShared();
  else editor.push();
}

/**
 * Remove macro `index` from the editor's patch and push it with the lanes it
 * moves on every part playing the patch, as one change: one undo step, the
 * other tabs out of date. An editor that cannot carry parts (a test's)
 * pushes the patch alone.
 */
export function removeMacroAndItsLanes(editor: PatchEditor, index: number): void {
  editor.patch.macros = removeMacro(editor.patch.macros, index);
  if (editor.pushShared) {
    editor.pushShared((doc, preset) => macroRemovalParts(doc, preset, index));
  } else {
    editor.push();
  }
}
