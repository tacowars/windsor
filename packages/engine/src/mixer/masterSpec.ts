/** Song-owned master settings (#666); missing means unity and no inserts. */
import { MIX_LEVEL_MAX } from '../audioConstants';
import { normaliseInserts } from '../inserts/insertRegistry';
import type { InsertSpec } from '../inserts/insertRegistry';
import type { FieldNormaliser } from '../song/arrangementFields';
export interface MasterSpec {
  readonly level: number;
  readonly inserts: readonly InsertSpec[];
}
export const DEFAULT_MASTER: MasterSpec = { level: 1, inserts: [] };
export function normaliseMaster(raw: unknown, n: FieldNormaliser): MasterSpec {
  const o = n.section(raw, 'master');
  n.dropUnknown(o, ['level', 'inserts'], 'master');
  return {
    level: n.num(o.level, DEFAULT_MASTER.level, 0, MIX_LEVEL_MAX, 'master.level'),
    inserts: normaliseInserts(o.inserts, 'master.inserts', n),
  };
}
