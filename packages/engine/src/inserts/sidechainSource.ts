/** A missing source means Internal; a null track is explicitly disconnected external. */
import { MUSIC_PARTS_MAX } from '../audioConstants';
import { isRecord, type FieldNormaliser } from '../song/arrangementFields';
import type { InsertSpec } from './insertRegistry';
export type SidechainSource = 'internal' | { readonly track: number | null };
export function normaliseSidechain(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
): SidechainSource {
  if (raw === undefined || raw === 'internal') return 'internal';
  if (isRecord(raw)) {
    n.dropUnknown(raw, ['track'], path);
    if (
      raw.track === null ||
      (Number.isInteger(raw.track) &&
        typeof raw.track === 'number' &&
        raw.track >= 0 &&
        raw.track < MUSIC_PARTS_MAX)
    ) {
      return { track: raw.track as number | null };
    }
  }
  n.correction(`${path}: invalid source — external disconnected`);
  return { track: null };
}

/** The kinds that key from a sidechain: the compressor and the Pump, whose specs carry `sidechain`. */
export type KeyedSpec = Extract<InsertSpec, { readonly kind: 'compressor' | 'pump' }>;

/** Whether `spec` keys from a sidechain, so the mixer routes a detector to it. */
export const isKeyedSpec = (spec: InsertSpec | undefined): spec is KeyedSpec =>
  spec?.kind === 'compressor' || spec?.kind === 'pump';

/** `spec` with its source set to `sidechain` when it keys from one; any other kind unchanged. */
export const withSidechain = (spec: InsertSpec, sidechain: SidechainSource): InsertSpec =>
  isKeyedSpec(spec) ? { ...spec, sidechain } : spec;
