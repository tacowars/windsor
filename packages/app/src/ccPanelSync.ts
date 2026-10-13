/**
 * What a document edit means to the CC router (windsor#784, record
 * `2026-10-13-midi-cc-mapping` decisions 2 and 7), read by comparing the
 * document before and after it, so no control has to report itself:
 *
 * - **Last in wins.** A mapped target whose own value moved (a knob turned
 *   on screen on any tab, an undo, a preset swap) has its CC value dropped
 *   and its mapping re-armed.
 * - **A lane let go.** A lane on a mapped target that was on and is now off
 *   or gone gave its slot back at the patch's value, so the mapping re-arms.
 *
 * The mappings themselves are the router's to compare (`mappingsChanged`).
 */
import type { ArrangementDocument, CcTargetId, DocumentPart } from '@windsor/engine';
import { partAt } from '@windsor/engine';

import type { PartCcMapping } from './ccEngine';
import { partPatch } from './ccPanelEngine';
import { currentValue } from './songAutomationModel';

/** One mapped target on one part. */
export interface CcPartTarget {
  readonly part: number;
  readonly target: CcTargetId;
}

/** The router's events in one edit. */
export interface CcDocumentEvents {
  /** Targets whose own value moved: last in wins. */
  readonly edited: readonly CcPartTarget[];
  /** Targets whose lane went off or away. */
  readonly released: readonly CcPartTarget[];
}

/** Every mapping in the song, with its part's slot. */
export const songCcMappings = (doc: ArrangementDocument): PartCcMapping[] =>
  doc.parts.flatMap((part) =>
    (part.ccMappings ?? []).map((mapping) => ({ part: part.slot, mapping })),
  );

/** Whether a lane on `target` is on in `part`. */
const laneOn = (part: DocumentPart, target: CcTargetId): boolean =>
  (part.automation ?? []).some((lane) => lane.target === target && lane.on);

/** The router's events between `before` and `after`, for the mappings `after` holds. */
export function ccDocumentEvents(
  before: ArrangementDocument,
  after: ArrangementDocument,
): CcDocumentEvents {
  const edited: CcPartTarget[] = [];
  const released: CcPartTarget[] = [];
  for (const { part: slot, mapping } of songCcMappings(after)) {
    const was = partAt(before, slot);
    const now = partAt(after, slot);
    if (!was || !now) continue;
    const { target } = mapping;
    const ownWas = currentValue(was, partPatch(before, was), target);
    const ownNow = currentValue(now, partPatch(after, now), target);
    if (ownWas !== ownNow) edited.push({ part: slot, target });
    if (laneOn(was, target) && !laneOn(now, target)) released.push({ part: slot, target });
  }
  return { edited, released };
}
