/**
 * The insert fields a lane may move on one insert as it stands (windsor#341,
 * record `2026-10-01-song-automation-lanes` decision 2): its kind's rows less
 * those its other settings leave unread, Tape's `wear` while split or its
 * `wow`, `flutter` and `dropouts` while not, for instance. The rows and their
 * `available` predicates are data in `automationInsertTables.ts`. Pure.
 */
import type { InsertSpec } from '../inserts/insertRegistry';
import { INSERT_AUTOMATION_FIELDS, type InsertFieldRow } from './automationInsertTables';

/** `spec`'s kind's rows the DSP reads under `spec`'s settings, in the catalog's order. */
export function automatableInsertFields(
  spec: InsertSpec,
  fields = INSERT_AUTOMATION_FIELDS,
): readonly InsertFieldRow[] {
  // The table pairs each kind with rows over that kind's spec, and `spec` is of its own kind.
  const rows = fields[spec.kind] as readonly InsertFieldRow[];
  return rows.filter((row) => row.available?.(spec) ?? true);
}
