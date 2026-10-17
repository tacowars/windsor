/**
 * The browser's Racks side without the DOM (windsor#884; record
 * `2026-10-17-racks` decision 18, the approved
 * `docs/design/rack-browser-mockup.html`): a rack as a row the shared
 * filter, facets and selection rules take, its chain line and pattern mark,
 * the Kind facet's counts, the info pane's rack rows, and a rename's name
 * check. The entries come from `LibraryModel.racks` (`rackLibrary.ts`).
 */
import type {
  InsertSpec,
  PresetFilter,
  PresetListing,
  RackEntry,
  SequencerKind,
} from '@windsor/engine';
import { filterPresets, isKeyedSpec } from '@windsor/engine';
import { fmtHz } from './consoleFormat';
import { INSERT_LABELS } from './insertKnobTables';
import type { LibraryEntries } from './patchMetadata';
import { ROW_SOURCE_LABELS } from './patchLibrary';
import { KIND_LABELS } from './sequencerConstants';

/** A rack as the table lists it: a listing row (so the shared rules apply) plus its chain and its pattern. */
export interface RackRow extends PresetListing {
  /** The chain's kinds' labels, in order; empty for an empty chain. */
  readonly chain: readonly string[];
  /** The sequencer kind the rack carries, or null. */
  readonly pattern: SequencerKind | null;
}

/** The label of an insert's kind. */
const kindLabel = (spec: InsertSpec): string => INSERT_LABELS[spec.kind] ?? spec.kind;

/** Every rack as a row: the user's own as Library, the bank as Built-in, by name. */
export function rackListing(
  racks: Readonly<Record<string, RackEntry>>,
  userIds: ReadonlySet<string>,
): RackRow[] {
  return Object.values(racks)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      tags: entry.tags,
      description: entry.description,
      source: userIds.has(entry.id) ? ('library' as const) : ('built-in' as const),
      chain: entry.inserts.map(kindLabel),
      pattern: entry.sequencer?.kind ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The kinds' labels joined by →, as the row reads it. */
export const chainLine = (chain: readonly string[]): string => chain.join(' → ');

/** The Kind facet's counts: the rows each kind would show under the search and the other facets. */
export function kindCounts(
  patches: readonly PresetListing[],
  racks: readonly PresetListing[],
  filter: PresetFilter,
): { patches: number; racks: number } {
  return {
    patches: filterPresets(patches, filter).length,
    racks: filterPresets(racks, filter).length,
  };
}

/** One insert of the pane's Chain row. */
export interface RackInsertInfo {
  readonly label: string;
  readonly enabled: boolean;
  /** The external sidechain key is written disconnected (decision 3). */
  readonly keyDisconnected: boolean;
}

/** The pane's rack rows, each absent where the rack carries no such member. */
export interface RackInfo {
  /** `<category> · <source> · Rack`. */
  readonly detail: string;
  /** The embedded patch's name, which is the rack's (decision 6). */
  readonly patchName: string;
  /** The library patch the rack came from, or null for a patch of its own. */
  readonly origin: { readonly name: string; readonly id: string } | null;
  readonly chain: readonly RackInsertInfo[];
  /** The sequencer kind's label, or null. */
  readonly sequencer: string | null;
  /** The low cut as `45 Hz`, or null. */
  readonly lowCut: string | null;
}

const insertInfo = (spec: InsertSpec): RackInsertInfo => ({
  label: kindLabel(spec),
  enabled: (spec as { enabled?: boolean }).enabled !== false,
  keyDisconnected:
    isKeyedSpec(spec) &&
    typeof spec.sidechain === 'object' &&
    spec.sidechain !== null &&
    spec.sidechain.track === null,
});

/** The info rows for `entry`, its provenance looked up in the patch library's entries. */
export function rackInfo(entry: RackEntry, row: RackRow, patches: LibraryEntries): RackInfo {
  const source = entry.patchSource;
  const origin =
    source !== undefined && Object.hasOwn(patches, source)
      ? { name: patches[source]!.name, id: source }
      : null;
  return {
    detail: `${row.category} · ${ROW_SOURCE_LABELS[row.source]} · Rack`,
    patchName: entry.patch.name,
    origin,
    chain: entry.inserts.map(insertInfo),
    sequencer: entry.sequencer ? KIND_LABELS[entry.sequencer.kind] : null,
    lowCut: entry.lowCut === undefined ? null : `${fmtHz(entry.lowCut)} Hz`,
  };
}

/** Why `name` cannot be a rack's name, or null: empty, or another rack's. */
export function rackNameProblem(
  name: string,
  racks: Readonly<Record<string, RackEntry>>,
  ownId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'A name is required.';
  const taken = Object.values(racks).some(
    (entry) => entry.id !== ownId && entry.name.toLowerCase() === trimmed.toLowerCase(),
  );
  return taken ? `A rack named "${trimmed}" already exists.` : null;
}

/** `name` as a fork of a built-in rack may use it: the name itself when free, else the first `name 2`, `name 3`… no rack has. */
export function forkName(name: string, racks: Readonly<Record<string, RackEntry>>): string {
  const free = (candidate: string): boolean => rackNameProblem(candidate, racks) === null;
  if (free(name)) return name;
  let n = 2;
  while (!free(`${name} ${n}`)) n += 1;
  return `${name} ${n}`;
}
