/** A missing source means Internal; a null track is explicitly disconnected external. */
import { MUSIC_PARTS_MAX } from '../audioConstants';
import { isRecord, type FieldNormaliser } from '../song/arrangementFields';
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
