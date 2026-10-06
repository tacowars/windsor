/**
 * The insert fields a lane may move (windsor#341, record
 * `2026-10-01-song-automation-lanes` decision 2): a kind's rows, and on one
 * insert as it stands those rows less the ones its other settings leave
 * unread, Tape's `wear` while split or its `wow`, `flutter` and `dropouts`
 * while not, for instance. The rows and their `available` predicates are data
 * in `automationInsertTables.ts`.
 *
 * Every kind whose spec has `enabled` also offers it, as
 * `INSERT_SWITCH_ROW`, after its continuous rows (windsor#628, record
 * `2026-10-06-insert-switch-lanes`): the one place it is added, so the
 * catalog's lookups (`automationTargets.ts`) and the picker see the same
 * rows. The switch is always read. Pure.
 */
import type { InsertKindName, InsertSpec } from '../inserts/insertRegistry';
import { INSERT_KINDS } from '../inserts/insertRegistry';
import {
  INSERT_AUTOMATION_FIELDS,
  INSERT_SWITCH_ROW,
  type InsertFieldRow,
} from './automationInsertTables';

/** `kind`'s rows: its continuous fields, then `toggle` where its spec has `enabled`. */
export function insertKindFields(
  kind: InsertKindName,
  fields = INSERT_AUTOMATION_FIELDS,
  toggle = INSERT_SWITCH_ROW,
): readonly InsertFieldRow[] {
  // The table pairs each kind with rows over that kind's spec.
  const rows = fields[kind] as readonly InsertFieldRow[];
  return Object.hasOwn(INSERT_KINDS[kind].defaults, toggle.target) ? [...rows, toggle] : rows;
}

/** `spec`'s kind's rows the DSP reads under `spec`'s settings, in the catalog's order. */
export function automatableInsertFields(
  spec: InsertSpec,
  fields = INSERT_AUTOMATION_FIELDS,
): readonly InsertFieldRow[] {
  return insertKindFields(spec.kind, fields).filter((row) => row.available?.(spec) ?? true);
}
