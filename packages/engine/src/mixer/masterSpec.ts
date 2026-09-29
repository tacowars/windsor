/** Song-owned master settings (#666); missing means unity and no inserts.
 * `output` is the engine's output stage (windsor#93): optional, and a song
 * without it plays on `DEFAULT_OUTPUT_STAGE` (the limiter at −1 dBFS). */
import { MIX_LEVEL_MAX } from '../audioConstants';
import { normaliseInserts } from '../inserts/insertRegistry';
import type { InsertSpec } from '../inserts/insertRegistry';
import type { FieldNormaliser } from '../song/arrangementFields';
import { isRecord } from '../song/arrangementFields';
import { DEFAULT_OUTPUT_STAGE, normaliseOutputStage } from './outputStageSpec';
import type { OutputStageSettings } from './outputStageSpec';
export interface MasterSpec {
  readonly level: number;
  readonly inserts: readonly InsertSpec[];
  readonly output?: OutputStageSettings;
}
export const DEFAULT_MASTER: MasterSpec = { level: 1, inserts: [] };
export function normaliseMaster(raw: unknown, n: FieldNormaliser): MasterSpec {
  const o = n.section(raw, 'master');
  n.dropUnknown(o, ['level', 'inserts', 'output'], 'master');
  const master: MasterSpec = {
    level: n.num(o.level, DEFAULT_MASTER.level, 0, MIX_LEVEL_MAX, 'master.level'),
    inserts: normaliseInserts(o.inserts, 'master.inserts', n),
  };
  return o.output === undefined
    ? master
    : { ...master, output: normaliseOutputStage(o.output, n, 'master.output') };
}
/** The output stage a master plays through: its own, or the default. */
export function masterOutput(master: MasterSpec | undefined): OutputStageSettings {
  return master?.output ?? DEFAULT_OUTPUT_STAGE;
}
/**
 * A live master partial over `spec`, with a partial `output` merged over the
 * settings in force, so `{ output: { mode: 'soft' } }` keeps the ceiling and
 * the lookahead. The rest is left to `normaliseMaster`, which the strip
 * runs over `{ ...spec, ...partial }`.
 */
export function mergeMasterPartial(spec: MasterSpec, partial: unknown): unknown {
  if (!isRecord(partial) || !isRecord(partial.output)) return partial;
  return { ...partial, output: { ...masterOutput(spec), ...partial.output } };
}
