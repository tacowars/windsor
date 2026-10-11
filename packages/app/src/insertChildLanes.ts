/**
 * A slot child's lanes on a kind change (windsor#692; record
 * `2026-10-11-wet-path-slot` decision 6). A host's child is automated as
 * `insert.<hostId>.slot.<field>`, with rows from the live child's kind, so a
 * new kind, None or ✕ drops every such lane. The drop rides in the same
 * partial as the chain, so one undo brings back the child, its id and its
 * lanes together. A same-kind edit (a knob) is an ordinary chain write and
 * keeps them.
 *
 * The holder is a part's strip or a group; a send bus and the master carry
 * no lanes. Pure over the document, so a test needs no DOM.
 */
import type { AutomationLane, DocumentPartial, InsertSpec } from '@windsor/engine';
import { parseTargetId, SLOT_FIELD } from '@windsor/engine';
import { partChange } from './context';
import { groupIdOfKey } from './groupModel';
import type { ChainTarget } from './insertTarget';
import { insertChange } from './insertTarget';
import type { LaneHolder } from './knobAutomation';

const SLOT_PREFIX = `${SLOT_FIELD}.`;

/** Whether `lane` drives a field of the child in the slot of the host `hostId`. */
export function isSlotLane(lane: AutomationLane, hostId: string): boolean {
  const target = parseTargetId(lane.target);
  return (
    target?.kind === 'insert' && target.insertId === hostId && target.field.startsWith(SLOT_PREFIX)
  );
}

/** What a child kind change writes: the host's next chain, where it lives, and whose lanes hold it. */
export interface ChildKindChange {
  readonly chain: ChainTarget;
  /** The chain's whole next list, the host's new child (or none) in it. */
  readonly inserts: readonly InsertSpec[];
  readonly hostId: string;
  /** The chain's lane holder (`insertLaneHolder`): a part, a group, or none. */
  readonly holder: LaneHolder | undefined;
}

/** The one partial for a child kind change: the chain, and the holder's lanes without the slot's. */
export function childKindChange({
  chain,
  inserts,
  hostId,
  holder,
}: ChildKindChange): DocumentPartial {
  const lanes = holder?.automation ?? [];
  const automation = lanes.filter((lane) => !isSlotLane(lane, hostId));
  if (automation.length === lanes.length) return insertChange(chain, inserts);
  if (typeof chain === 'number') return partChange(chain, { strip: { inserts }, automation });
  const group = groupIdOfKey(chain);
  return group === null
    ? insertChange(chain, inserts)
    : ({ groups: { [group]: { inserts, automation } } } as DocumentPartial);
}
