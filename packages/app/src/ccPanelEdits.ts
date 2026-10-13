/**
 * The MIDI CC panel's edits to a part's mappings (windsor#784, record
 * `2026-10-13-midi-cc-mapping` decisions 1, 5 and 10): a row's device or
 * channel widened to Any and back, its range, its `Inv`, and its removal.
 * Each returns the part's whole new list, since a merge replaces an array
 * wholesale, for one `ctx.change` and one undo step (`ccMappingsChange`).
 * The router compares the lists itself: a source edit forgets the hardware
 * position, a range or `Inv` edit re-arms pickup.
 */
import type { AutomationTargetRow, CcMapping, CcSource, CcTargetId } from '@windsor/engine';

/** `mappings` with the one on `target` replaced by `edit` of it. */
const editing = (
  mappings: readonly CcMapping[],
  target: CcTargetId,
  edit: (mapping: CcMapping) => CcMapping,
): CcMapping[] => mappings.map((m) => (m.target === target ? edit(m) : m));

/** The mapping on `target` listening to `source`'s device or channel instead (null for Any). */
export const withSource = (
  mappings: readonly CcMapping[],
  target: CcTargetId,
  source: Partial<Pick<CcSource, 'device' | 'channel'>>,
): CcMapping[] => editing(mappings, target, (m) => ({ ...m, source: { ...m.source, ...source } }));

/** The mapping on `target` with `Inv` flipped. */
export const withInverted = (mappings: readonly CcMapping[], target: CcTargetId): CcMapping[] =>
  editing(mappings, target, (m) => ({ ...m, inverted: !m.inverted }));

/** Which end of a range. */
export type CcRangeEnd = 'min' | 'max';

/** The mapping on `target` with its `end` at `value`, clamped to `row`. */
export function withRangeEnd(
  mappings: readonly CcMapping[],
  target: CcTargetId,
  end: CcRangeEnd,
  value: number,
  row: AutomationTargetRow,
): CcMapping[] {
  const clamped = Math.min(row.max, Math.max(row.min, value));
  return editing(mappings, target, (m) => ({ ...m, [end]: clamped }));
}

/** `mappings` without the one on `target`. */
export const withoutMapping = (mappings: readonly CcMapping[], target: CcTargetId): CcMapping[] =>
  mappings.filter((m) => m.target !== target);
