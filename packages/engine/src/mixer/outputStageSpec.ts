/**
 * The song's output stage settings (windsor#93 decision 11): `master.output`
 * in the song document, `{ mode, ceilingDb, lookahead }`. The field is
 * optional and additive; a song without it plays on `DEFAULT_OUTPUT_STAGE`.
 * Present, it is normalised in full: a missing field takes its default, and
 * a junk or out-of-range one is replaced or clamped with a correction, as
 * the other master fields are. `outputStageSpec.test.ts` pins it.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import {
  OUTPUT_CEILING_DB,
  OUTPUT_STAGE_DEFAULTS,
  OUTPUT_STAGE_MODES,
} from './outputStageConstants';
import type { OutputStageMode } from './outputStageConstants';

export interface OutputStageSettings {
  readonly mode: OutputStageMode;
  /** The ceiling in dBFS, `OUTPUT_CEILING_DB.min` to `.max`. */
  readonly ceilingDb: number;
  /** The limiter's lookahead; ignored by the other modes. */
  readonly lookahead: boolean;
}

export const DEFAULT_OUTPUT_STAGE: OutputStageSettings = OUTPUT_STAGE_DEFAULTS;

export const OUTPUT_STAGE_KEYS = ['mode', 'ceilingDb', 'lookahead'] as const;

export function normaliseOutputStage(
  raw: unknown,
  n: FieldNormaliser,
  path = 'master.output',
): OutputStageSettings {
  const o = n.section(raw, path);
  n.dropUnknown(o, OUTPUT_STAGE_KEYS, path);
  const d = DEFAULT_OUTPUT_STAGE;
  return {
    mode: n.pick(o.mode, OUTPUT_STAGE_MODES, d.mode, `${path}.mode`),
    ceilingDb: n.num(
      o.ceilingDb,
      d.ceilingDb,
      OUTPUT_CEILING_DB.min,
      OUTPUT_CEILING_DB.max,
      `${path}.ceilingDb`,
    ),
    lookahead: n.bool(o.lookahead, d.lookahead, `${path}.lookahead`),
  };
}
