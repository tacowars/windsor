/**
 * How an insert's automation row is built (windsor#341): one field's target,
 * label, bounds, scale and unit (`row`), and the predicate that limits it to
 * the settings where the DSP reads it (`when`). The rows themselves, kind by
 * kind, are `automationInsertTables.ts`.
 */
import type { InsertKindName, InsertSpec } from '../inserts/insertRegistry';
import type { AutomationScale, AutomationTargetRow } from './automationLane';

export type Bounds = readonly [number, number];

/** An insert kind's spec, by its name. */
export type InsertSpecOf<K extends InsertKindName> = Extract<InsertSpec, { readonly kind: K }>;

/**
 * An insert field's row. `available`, when present, says whether the DSP
 * reads the field under `spec`'s other settings; absent, it always does.
 */
export interface InsertFieldRow<S extends InsertSpec = InsertSpec> extends AutomationTargetRow {
  readonly available?: (spec: S) => boolean;
  /** On a host's slot row (`slotRows`), the child kind whose field it moves. */
  readonly childKind?: InsertKindName;
}

/** `r`, read by the DSP only where `available` holds. */
export const when = <S extends InsertSpec>(
  r: AutomationTargetRow,
  available: (spec: S) => boolean,
): InsertFieldRow<S> => ({ ...r, available });

/** A mix, a share or a depth: 0..1. */
export const UNIT: Bounds = [0, 1];

/** One row: a field, its label, its bounds, its scale and its unit. */
export function row(
  target: string,
  label: string,
  [min, max]: Bounds,
  scale: AutomationScale = 'linear',
  unit = '',
): AutomationTargetRow {
  return { target, label, min, max, scale, unit };
}
