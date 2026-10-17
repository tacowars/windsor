/**
 * The patch box's RACK tag without the DOM (windsor#885; record
 * `2026-10-17-racks` decisions 14 and 19): while the part was loaded from a
 * rack the library still holds, the rack's name for the tag's title and
 * whether the part differs from it, which lights the tag's dot.
 */
import type { DocumentPart, Patch, RackEntry } from '@windsor/engine';
import { rackDifferences } from './rackActions';

export interface RackTag {
  readonly id: string;
  readonly name: string;
  /** The part's patch, chain, low cut or sequencer differs from the rack (decision 14). */
  readonly modified: boolean;
}

/** The tag for `part`, or null without a `rackSource` the library holds. */
export function rackTag(
  part: DocumentPart | undefined,
  patch: Patch | undefined,
  racks: Readonly<Record<string, RackEntry>>,
): RackTag | null {
  const id = part?.rackSource;
  if (!part || id === undefined || !Object.hasOwn(racks, id)) return null;
  const rack = racks[id]!;
  return { id, name: rack.name, modified: rackDifferences(part, patch, rack).length > 0 };
}
