/**
 * The song-owned insert locations: a part's strip by slot, the master (#666),
 * the two send buses (windsor#172) and the song's group buses by key,
 * `group:3` (windsor#287), which no slot or bus name can collide with. Cards
 * share one document/live target.
 *
 * A host's slot child (windsor#692, record `2026-10-11-wet-path-slot`) is a
 * target too: a one-entry chain, `child:<chain>/<hostId>`, addressed by the
 * host's id so a reorder can't point it at another insert. Reading it is the
 * host's `slot`, writing it writes the host's chain with `slot` replaced, and
 * its live stage is the host stage's live child. So every card draws a child
 * as `card(ctx, childTarget, 0)`, with no second layout. It is named `child`
 * because `slot` already means a part's slot here.
 */
import type { DocumentPartial, InsertSpec, InsertStage, ReturnName } from '@windsor/engine';
import {
  RETURNS,
  insertSlot,
  isReturnName,
  partAt,
  musicPartName,
  SLOT_FIELD,
  slotChild,
  withInsertIds,
} from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { groupAt, groupIdOfKey } from './groupModel';
import type { LaneHolder } from './knobAutomation';
import { insertLaneHolder } from './knobAutomation';
/** A group bus's chain, by the group's key (`groupModel.ts`'s `groupKey`). */
export type GroupTarget = `group:${number}`;
/** A chain the song holds: a part's strip, the master, a send bus or a group bus. */
export type ChainTarget = number | 'master' | ReturnName | GroupTarget;
/** A host's slot child, as a one-entry chain (`childTarget`). */
export type ChildTarget = `child:${string}`;
export type InsertTarget = ChainTarget | ChildTarget;
/** Whether `target` is a send bus, Send A or Send B. */
export const isBusTarget = (target: InsertTarget): target is ReturnName => isReturnName(target);
/** Whether `target` is a group bus. */
export const isGroupTarget = (target: InsertTarget): target is GroupTarget =>
  typeof target === 'string' && groupIdOfKey(target) !== null;
/** The id of the group a group target names. */
const groupIdOf = (target: GroupTarget): number => groupIdOfKey(target) ?? -1;

const CHILD_PREFIX = 'child:';
/** Between the chain and the host's id: no chain's name holds it, so an id may. */
const CHILD_SEPARATOR = '/';
const SLOT_DIGITS = /^\d+$/;

/** Where a slot child lives: the host's chain and the host's id. */
export interface ChildAddress {
  readonly chain: ChainTarget;
  readonly hostId: string;
}

/** The target for the child in the slot of the host `hostId` in `chain`. */
export const childTarget = (chain: ChainTarget, hostId: string): ChildTarget =>
  `${CHILD_PREFIX}${chain}${CHILD_SEPARATOR}${hostId}`;

/** The chain a chain target's text names, or null. */
function chainOfText(text: string): ChainTarget | null {
  if (SLOT_DIGITS.test(text)) return Number(text);
  if (text === 'master' || isReturnName(text)) return text;
  return groupIdOfKey(text) === null ? null : (text as GroupTarget);
}

/** The host a child target names, or null for any other target: `childTarget`'s inverse. */
export function childAddress(target: InsertTarget): ChildAddress | null {
  if (typeof target !== 'string' || !target.startsWith(CHILD_PREFIX)) return null;
  const rest = target.slice(CHILD_PREFIX.length);
  const cut = rest.indexOf(CHILD_SEPARATOR);
  const chain = cut < 0 ? null : chainOfText(rest.slice(0, cut));
  const hostId = rest.slice(cut + 1);
  return chain === null || hostId === '' ? null : { chain, hostId };
}

/** Whether `target` is a host's slot child. */
export const isChildTarget = (target: InsertTarget): target is ChildTarget =>
  childAddress(target) !== null;

/** A bus's chain as the document holds it, else the code's default chain. */
const busInserts = (ctx: AppCtx, bus: ReturnName): readonly InsertSpec[] =>
  ctx.model.doc.returns?.[bus]?.inserts ?? RETURNS[bus].inserts;

function chainInserts(ctx: AppCtx, chain: ChainTarget): readonly InsertSpec[] {
  if (isGroupTarget(chain)) return groupAt(ctx.model.doc, groupIdOf(chain))?.inserts ?? [];
  return chain === 'master'
    ? (ctx.model.doc.master?.inserts ?? [])
    : isBusTarget(chain)
      ? busInserts(ctx, chain)
      : (partAt(ctx.model.doc, chain)?.strip.inserts ?? []);
}

/**
 * The host's chain with each insert's id (a chain the code holds gets the ids
 * normalising will give it) and the host's index in it, -1 once it is gone.
 */
export function hostIn(
  ctx: AppCtx,
  { chain, hostId }: ChildAddress,
): { readonly list: InsertSpec[]; readonly index: number } {
  const list = withInsertIds(chainInserts(ctx, chain));
  return { list, index: list.findIndex((spec) => spec.id === hostId) };
}

export function insertsOf(ctx: AppCtx, target: InsertTarget): readonly InsertSpec[] {
  const child = childAddress(target);
  if (!child) return chainInserts(ctx, target as ChainTarget);
  const { list, index } = hostIn(ctx, child);
  const held = list[index] && insertSlot(list[index]);
  return held ? [held] : [];
}

/** The partial that sets `chain`'s whole insert list. */
export function insertChange(chain: ChainTarget, inserts: readonly InsertSpec[]): DocumentPartial {
  if (isGroupTarget(chain)) return { groups: { [groupIdOf(chain)]: { inserts } } };
  return chain === 'master'
    ? { master: { inserts } }
    : isBusTarget(chain)
      ? { returns: { [chain]: { inserts } } }
      : partChange(chain, { strip: { inserts } });
}

/**
 * The partial that sets `target`'s insert list: a chain's, or for a slot
 * child its host's chain with `slot` set to the list's one entry (or none).
 */
export function targetChange(
  ctx: AppCtx,
  target: InsertTarget,
  inserts: readonly InsertSpec[],
): DocumentPartial {
  const child = childAddress(target);
  if (!child) return insertChange(target as ChainTarget, inserts);
  const { list, index } = hostIn(ctx, child);
  const next = list.map((spec, i) =>
    i === index ? ({ ...spec, slot: inserts[0] ?? null } as InsertSpec) : spec,
  );
  return insertChange(child.chain, next);
}

function chainStage(
  ctx: AppCtx,
  chain: ChainTarget,
  index: number,
): InsertStage<InsertSpec> | undefined {
  const system = ctx.host.system;
  if (isGroupTarget(chain)) return system?.groupBus(groupIdOf(chain))?.inserts[index];
  return chain === 'master'
    ? system?.masterStrip?.inserts[index]
    : isBusTarget(chain)
      ? system?.returnBus(chain)?.inserts[index]
      : system?.strip(musicPartName(chain))?.inserts[index];
}

export function liveInsert(
  ctx: AppCtx,
  target: InsertTarget,
  index: number,
): InsertStage<InsertSpec> | undefined {
  const child = childAddress(target);
  if (!child) return chainStage(ctx, target as ChainTarget, index);
  const host = hostIn(ctx, child).index;
  return index === 0 && host >= 0 ? slotChild(chainStage(ctx, child.chain, host)) : undefined;
}

/**
 * Where the lanes on the insert at `index` in `target`'s chain live: the
 * chain's lane holder (a part's strip or a group, `insertLaneHolder`), the
 * insert, and the prefix its fields carry in a lane's target. For a slot
 * child that is the host's holder, the host and `slot.` (windsor#692
 * decision 8), so its rows are found through `automatableInsertFields(host)`.
 * A knob's lock and the EQ's curve both resolve a target through this.
 */
export interface InsertLaneScope {
  readonly holder: LaneHolder | undefined;
  readonly spec: InsertSpec | undefined;
  readonly fieldPrefix: string;
}

export function insertLaneScope(ctx: AppCtx, target: InsertTarget, index: number): InsertLaneScope {
  const child = childAddress(target);
  if (!child) {
    const holder = insertLaneHolder(ctx.model.doc, target);
    return { holder, spec: insertsOf(ctx, target)[index], fieldPrefix: '' };
  }
  const host = hostIn(ctx, child);
  return {
    holder: insertLaneHolder(ctx.model.doc, child.chain),
    spec: host.list[host.index],
    fieldPrefix: `${SLOT_FIELD}.`,
  };
}
