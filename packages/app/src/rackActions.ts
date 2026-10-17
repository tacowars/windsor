/**
 * The pure rack rules (windsor#868, record `2026-10-17-racks` decisions 2,
 * 3, 10, 12 and 14): a rack built from a part, a rack loaded into a part as
 * one partial, a part added from a rack, and the member-by-member difference
 * the rack's modified dot reads. Every function takes the normalised
 * document and returns a value; the browser (issue D) calls them.
 */
import type {
  ArrangementDocument,
  DocumentPart,
  DocumentPartial,
  InsertSpec,
  Patch,
  RackFile,
  RegionPattern,
  SequencerKind,
  SequencerSpec,
} from '@windsor/engine';
import {
  LOW_CUT_MIN_HZ,
  PATCH_FILE_FORMAT,
  PATCH_ID_RULE,
  RACK_FILE_FORMAT,
  RACK_FILE_KIND,
  SEEDED_KINDS,
  SEQ_AUTOMATION_FIELDS,
  clonePatch,
  isKeyedSpec,
  parseTargetId,
  partAt,
  patchLeafDifferences,
  targetRow,
} from '@windsor/engine';
import type { AutoCopies } from './autoCopies';
import { partChange } from './context';
import type { LibraryModel } from './libraryModel';
import { leftCopyDrop } from './partCopyCleanup';
import type { Preview } from './partEdits';
import type { PatchMetadata } from './patchMetadata';
import { sansName, uniqueId } from './patchMetadata';
import { addPart, setSequencerKind } from './songParts';

/** What Save as rack… collects: the metadata, and which optional members ride along. */
export interface RackSaveOptions extends PatchMetadata {
  /** Include the strip's low cut. */
  lowCut: boolean;
  /** Include the part's sequencer, without its seed. */
  sequencer: boolean;
}

/** The two boxes' defaults (decision 13): the low cut when above its floor, the sequencer when the kind is not none. */
export const saveMembersFor = (part: DocumentPart): { lowCut: boolean; sequencer: boolean } => ({
  lowCut: part.strip.lowCut > LOW_CUT_MIN_HZ,
  sequencer: part.sequencer.kind !== 'none',
});

/** A rack as the actions take it: its library id and its file. */
export interface RackRef {
  readonly id: string;
  readonly file: RackFile;
}

/** The members a part and a rack may differ on. */
export type RackMember = 'patch' | 'inserts' | 'lowCut' | 'sequencer';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The spec without the part's seed: what a rack carries, and what a part is compared on. */
export function withoutSeed(spec: SequencerSpec): RegionPattern {
  const copy: Record<string, unknown> = { ...spec };
  delete copy['seed'];
  return copy as RegionPattern;
}

/** `spec` with an external sidechain key written disconnected: a rack names no part (decision 3). */
function unkeyed(spec: InsertSpec): InsertSpec {
  if (!isKeyedSpec(spec)) return spec;
  const source = spec.sidechain;
  return isRecord(source) && typeof source.track === 'number'
    ? { ...spec, sidechain: { track: null } }
    : spec;
}

/** `unkeyed` over an insert and its wet-path child. */
function unkeyedWithChild(spec: InsertSpec): InsertSpec {
  const own = unkeyed(spec);
  const child = (own as { slot?: InsertSpec | null }).slot;
  return child ? ({ ...own, slot: unkeyed(child) } as InsertSpec) : own;
}

/**
 * The rack a part's sound makes (decision 2): its song patch by value under
 * the rack's name, its provenance, its chain with every external key
 * cleared, and the low cut and the sequencer when asked. Null when the slot
 * has no part or its patch is missing from the song.
 */
export function rackFromPart(
  doc: ArrangementDocument,
  slot: number,
  options: RackSaveOptions,
  libraryIds: ReadonlySet<string>,
): RackFile | null {
  const part = partAt(doc, slot);
  const patch = part && doc.patches?.[part.preset];
  if (!part || !patch) return null;
  // The song keeps any non-empty link; the file takes a slug only, so a link that is none is left out.
  const own = part.patchSource !== undefined && PATCH_ID_RULE.test(part.patchSource);
  const source = own ? part.patchSource : libraryIds.has(part.preset) ? part.preset : undefined;
  return {
    format: RACK_FILE_FORMAT,
    kind: RACK_FILE_KIND,
    name: options.name,
    category: options.category,
    tags: [...options.tags],
    description: options.description,
    patchFormat: PATCH_FILE_FORMAT,
    patch: { ...clonePatch(patch), name: options.name },
    ...(source !== undefined && { patchSource: source }),
    ...(options.lowCut && { lowCut: part.strip.lowCut }),
    ...(options.sequencer && { sequencer: withoutSeed(part.sequencer) }),
    inserts: part.strip.inserts.map(unkeyedWithChild),
  };
}

/** What a load's lanes and mappings are checked against: the rack's chain, and its sequencer kind when it brings one. */
interface LoadedTargets {
  readonly specOf: (id: string) => InsertSpec | undefined;
  readonly seqKind: SequencerKind | undefined;
}

/**
 * True when `target` survives the load: a strip or voice row always; an
 * insert row the new chain's insert of that id has, by the lookup the lane
 * and CC normalisers make; a sequencer row the rack's kind offers, by their
 * table. A target the engine would drop after the load (a host kept with
 * its slot emptied, an id now of another kind, a row the new sequencer kind
 * lacks) goes in the load itself, so the live partial and the document agree.
 */
function keptTarget(target: string, loaded: LoadedTargets): boolean {
  const parsed = parseTargetId(target);
  if (parsed?.kind === 'insert') return targetRow(target, loaded.specOf) !== undefined;
  if (parsed?.kind === 'seq' && loaded.seqKind !== undefined)
    return (SEQ_AUTOMATION_FIELDS[loaded.seqKind] ?? []).includes(parsed.field);
  return true;
}

/**
 * The part's sequencer and regions as the rack's pattern sets them: the
 * whole spec with the part's own seed when the kind is unchanged and a new
 * part's when it is not, and the regions as a kind change leaves them
 * (`setSequencerKind`: patterns of the old kind dropped, a Roll's one ∞
 * region fitted later), sent only when they changed.
 */
function sequencerFields(
  doc: ArrangementDocument,
  slot: number,
  part: DocumentPart,
  pattern: RegionPattern,
): Record<string, unknown> {
  const kind: SequencerKind = pattern.kind;
  const same = part.sequencer.kind === kind;
  const ownSeed = 'seed' in part.sequencer ? part.sequencer.seed : undefined;
  const seed = SEEDED_KINDS.includes(kind) ? { seed: same ? (ownSeed ?? 0) : 0 } : {};
  const sequencer = { ...pattern, ...seed };
  const next = setSequencerKind(doc, slot, kind);
  if (next === doc) return { sequencer };
  const after = (next as ArrangementDocument).parts.find((entry) => entry.slot === slot);
  const changed =
    after !== undefined &&
    (part.regions.length !== after.regions.length ||
      part.regions.some((region) => region.pattern !== undefined));
  return changed && after ? { sequencer, regions: after.regions } : { sequencer };
}

/** The part fields and the `patches` entries a rack load writes (decision 10), before they are shaped as a partial. */
function rackLoad(
  doc: ArrangementDocument,
  slot: number,
  rack: RackRef,
  library: LibraryModel,
  auto: Pick<AutoCopies, 'has'>,
): { fields: Record<string, unknown>; patches: Record<string, Patch | null> } | null {
  const part = partAt(doc, slot);
  if (!part) return null;
  const { file } = rack;
  const taken = [...Object.keys(library.entries), ...Object.keys(doc.patches ?? {})];
  // The same rack loaded again (Revert rack) writes over the part's own copy of it, so a
  // revert leaves no copy behind; any other load gets a fresh id.
  const ownCopy =
    part.rackSource === rack.id &&
    Object.hasOwn(doc.patches ?? {}, part.preset) &&
    !Object.hasOwn(library.entries, part.preset) &&
    !doc.parts.some((other) => other.slot !== slot && other.preset === part.preset);
  const patchId = ownCopy ? part.preset : uniqueId(rack.id, taken);
  const source = file.patchSource;
  const patchSource = source && Object.hasOwn(library.entries, source) ? source : undefined;
  const specs = new Map(
    file.inserts.flatMap((spec) => (spec.id === undefined ? [] : [[spec.id, spec] as const])),
  );
  const loaded: LoadedTargets = {
    specOf: (id) => specs.get(id),
    seqKind: file.sequencer?.kind,
  };
  const automation = part.automation?.filter((lane) => keptTarget(lane.target, loaded));
  const ccMappings = part.ccMappings?.filter((mapping) => keptTarget(mapping.target, loaded));
  const fields: Record<string, unknown> = {
    preset: patchId,
    patchSource,
    rackSource: rack.id,
    strip: { inserts: file.inserts, ...(file.lowCut !== undefined && { lowCut: file.lowCut }) },
    ...(automation && automation.length !== part.automation?.length && { automation }),
    ...(ccMappings && ccMappings.length !== part.ccMappings?.length && { ccMappings }),
    ...(file.sequencer && sequencerFields(doc, slot, part, file.sequencer)),
  };
  const dropped = leftCopyDrop(doc, slot, patchId, library, auto);
  return { fields, patches: { [patchId]: clonePatch(file.patch), ...dropped } };
}

/**
 * Rack `rack` loaded into the part on `slot`, one partial and one undo step
 * (decision 10). Null when the slot has no part.
 */
export function loadRackChange(
  doc: ArrangementDocument,
  slot: number,
  rack: RackRef,
  library: LibraryModel,
  auto: Pick<AutoCopies, 'has'>,
): DocumentPartial | null {
  const load = rackLoad(doc, slot, rack, library, auto);
  if (!load) return null;
  return { ...partChange(slot, load.fields), patches: load.patches } as DocumentPartial;
}

/**
 * A new part on the lowest free slot, playing `rack` (decision 12): the
 * normalised new part with the load's fields over it, in one partial, and
 * the rack's patch alone in `patches`, so no Init patch is ever written.
 * Null when the song is full.
 */
export function addPartFromRackChange(
  doc: ArrangementDocument,
  preview: Preview,
  rack: RackRef,
  library: LibraryModel,
  auto: Pick<AutoCopies, 'has'>,
): { partial: DocumentPartial; slot: number } | null {
  const added = addPart(doc);
  if (!added) return null;
  const normalised = preview(added.doc);
  const part = partAt(normalised, added.slot);
  const load = part && rackLoad(normalised, added.slot, rack, library, auto);
  if (!part || !load) return null;
  const { strip, ...rest } = load.fields;
  const whole = { ...part, ...rest, strip: { ...part.strip, ...(strip as object) } };
  return {
    slot: added.slot,
    partial: { parts: { [added.slot]: whole }, patches: load.patches } as DocumentPartial,
  };
}

/** The rack under a new name, which is its embedded patch's too (decision 6); the id stays. */
export function renamedRack(file: RackFile, name: string): RackFile {
  return { ...file, name, patch: { ...file.patch, name } };
}

/**
 * The members on which the part differs from the rack it came from
 * (decision 14): the patch by its leaves less its name, the chain with its
 * external keys cleared as the file writes them (decision 3, so a part
 * keyed from another part is clean against its rack), the low cut and the
 * sequencer less seed, a member the rack lacks never counting. Empty is
 * unmodified.
 */
export function rackDifferences(
  part: DocumentPart,
  patch: Patch | undefined,
  rack: RackFile,
): RackMember[] {
  const out: RackMember[] = [];
  if (!patch || patchLeafDifferences(sansName(patch), sansName(rack.patch)).length)
    out.push('patch');
  if (patchLeafDifferences(part.strip.inserts.map(unkeyedWithChild), rack.inserts).length)
    out.push('inserts');
  if (rack.lowCut !== undefined && part.strip.lowCut !== rack.lowCut) out.push('lowCut');
  if (rack.sequencer && patchLeafDifferences(withoutSeed(part.sequencer), rack.sequencer).length)
    out.push('sequencer');
  return out;
}
