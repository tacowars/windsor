/**
 * A part's MIDI CC mappings, normalised (windsor#782, record
 * `2026-10-13-midi-cc-mapping` decisions 9 and 10). Every case is a
 * correction, never a refusal, reported through the `arrangementFields`
 * vocabulary as a part's lanes are (`automationNormalise.ts`):
 *
 * - **The target.** A mapping whose target `isCcMappableTarget` refuses (a
 *   switch, a `seq.` row, an id the catalog lacks) is dropped. So is one on
 *   an insert id the part's strip does not hold, or on a field that insert's
 *   kind does not automate, which is how deleting an insert deletes its
 *   mappings: normalising runs after every merge, as it does for lanes.
 * - **The patch is not read.** A macro the part's patch does not define, or
 *   a voice target one of its macros maps, keeps its mapping: it is inert at
 *   play time and plays again when the patch allows (decision 10), so a
 *   preset swap keeps every voice mapping.
 * - **The source.** A CC outside 0–127 or on `CC_MAPPING_IGNORED`, or a
 *   channel outside 1–16, drops the mapping. A missing device or channel is
 *   Any (null); a device that is not a name is Any, reported.
 * - **The range.** `min` and `max` are clamped to the target's row, and a
 *   missing one is the row's end, as a new mapping's is. `inverted` is false
 *   when missing.
 * - **Duplicates.** Of two mappings on one target, the first wins.
 * - **No cap.** Mappings past the voice's `FM_LANES_MAX` slots are kept:
 *   the console orders them at play time (decision 8).
 * - **Empty.** A part with no mappings left has no `ccMappings` key, so a
 *   song without them exports as before.
 *
 * The CC values themselves are never saved (decision 2).
 * `ccMappingNormalise.test.ts` pins each case.
 */
import type { AutomationTargetRow } from '../automation/automationLane';
import { targetRow } from '../automation/automationTargets';
import type { InsertSpec } from '../inserts/insertRegistry';
import { type FieldNormaliser, show } from './arrangementFields';
import { type CcMapping, type CcSource, type CcTargetId, isCcMappableTarget } from './ccMapping';
import { CC_CHANNEL_MAX, CC_DATA_MAX, CC_MAPPING_IGNORED } from './ccMappingTables';

/** What a part's mappings are normalised against. */
export interface CcMappingContext {
  /** The part's normalised inserts, each with its id: an insert mapping needs one of them. */
  readonly inserts: readonly InsertSpec[];
  readonly path: string;
  readonly n: FieldNormaliser;
}

const MAPPING_KEYS = ['source', 'target', 'min', 'max', 'inverted'];
const SOURCE_KEYS = ['device', 'channel', 'cc'];
const CHANNEL_MIN = 1;

/** A part's mappings: absent when it has none, corrected as the file's header says. */
export function normaliseCcMappings(
  raw: unknown,
  context: CcMappingContext,
): CcMapping[] | undefined {
  const { path, n } = context;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of CC mappings — dropped`);
    return undefined;
  }
  const specs = new Map<string, InsertSpec>();
  for (const spec of context.inserts) if (spec.id !== undefined) specs.set(spec.id, spec);
  const rowOf = (target: string): AutomationTargetRow | undefined =>
    targetRow(target, (insertId) => specs.get(insertId));
  const taken = new Set<string>();
  const out: CcMapping[] = [];
  raw.forEach((entry, i) => {
    const at = `${path}[${i}]`;
    const mapping = normaliseMapping(entry, at, rowOf, n);
    if (!mapping) return;
    if (taken.has(mapping.target)) {
      n.correction(`${at}: an earlier mapping moves ${mapping.target} — mapping dropped`);
      return;
    }
    taken.add(mapping.target);
    out.push(mapping);
  });
  return out.length > 0 ? out : undefined;
}

function normaliseMapping(
  raw: unknown,
  path: string,
  rowOf: (target: string) => AutomationTargetRow | undefined,
  n: FieldNormaliser,
): CcMapping | undefined {
  const o = n.section(raw, path);
  n.dropUnknown(o, MAPPING_KEYS, path);
  const target = o.target;
  if (typeof target !== 'string' || !isCcMappableTarget(target)) {
    n.correction(`${path}.target: ${show(target)} is no mappable target — mapping dropped`);
    return undefined;
  }
  const row = rowOf(target);
  if (!row) {
    n.correction(`${path}.target: the part has no ${target} — mapping dropped`);
    return undefined;
  }
  const source = normaliseSource(o.source, `${path}.source`, n);
  if (!source) return undefined;
  return {
    source,
    target: target as CcTargetId,
    min: n.num(o.min, row.min, row.min, row.max, `${path}.min`),
    max: n.num(o.max, row.max, row.min, row.max, `${path}.max`),
    inverted: n.bool(o.inverted, false, `${path}.inverted`),
  };
}

const isIntIn = (value: unknown, lo: number, hi: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;

/** A mapping's source, or undefined (reported) when its CC or channel cannot be one. */
function normaliseSource(raw: unknown, path: string, n: FieldNormaliser): CcSource | undefined {
  const o = n.section(raw, path);
  n.dropUnknown(o, SOURCE_KEYS, path);
  const { cc, channel, device } = o;
  if (!isIntIn(cc, 0, CC_DATA_MAX) || CC_MAPPING_IGNORED.has(cc)) {
    n.correction(`${path}.cc: ${show(cc)} is no mappable controller — mapping dropped`);
    return undefined;
  }
  const any = channel === undefined || channel === null;
  if (!any && !isIntIn(channel, CHANNEL_MIN, CC_CHANNEL_MAX)) {
    n.correction(`${path}.channel: ${show(channel)} is no MIDI channel — mapping dropped`);
    return undefined;
  }
  const named = device === undefined || device === null || typeof device === 'string';
  if (!named) n.correction(`${path}.device: ${show(device)} is not a device name — using Any`);
  return {
    device: typeof device === 'string' ? device : null,
    channel: isIntIn(channel, CHANNEL_MIN, CC_CHANNEL_MAX) ? channel : null,
    cc,
  };
}
