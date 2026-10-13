/**
 * A knob's right-click menu, as values (windsor#785, record
 * `2026-10-13-midi-cc-mapping` decisions 8 and 12, drawn as the approved
 * mockup's `.ctx` menu): on a knob whose target is in the catalog, **Learn
 * MIDI CC…**, and on a mapped knob also **Edit mapping…** and **Remove CC
 * <n>**. `knobCcMenu.ts` is the DOM over it.
 *
 * Learn is refused, shown disabled with its reason, on a group's, a return's
 * or the master's knob (no part owns it), on a knob a macro mapping holds
 * (the voice has no handle there), and on a voice target or macro that would
 * take a ninth voice slot (`partVoiceSlots.ts`; a target already counted
 * shares its slot). The head names the target as the lane picker does, with
 * the mapping's CC; Learn's tag says what learning does: the slot it takes,
 * or the source it replaces.
 */
import type { DocumentPart, Patch } from '@windsor/engine';
import { FM_LANES_MAX, isCcMappableTarget, targetKind, voicePathOf } from '@windsor/engine';

import { slotsFullWhy } from './ccPanelTargets';
import type { KnobAutomation } from './knobAutomation';
import type { KnobCcAt } from './knobCc';
import { voiceSlotTargets } from './partVoiceSlots';
import { laneRow } from './songAutomationModel';

/** What an item does. */
export type KnobCcAction = 'learn' | 'edit' | 'remove';

/** One item of the menu. */
export interface KnobCcMenuItem {
  readonly action: KnobCcAction;
  readonly label: string;
  /** The note at its right edge, or null. */
  readonly tag: string | null;
  /** Why it can't be chosen, shown in its tag and title; null when it can. */
  readonly refused: string | null;
  readonly danger: boolean;
}

/** The menu: a head naming the target, a divider before the danger items. */
export interface KnobCcMenu {
  readonly head: string;
  readonly items: readonly KnobCcMenuItem[];
}

/** The refusal on a knob no part owns. */
export const NOT_A_PART_WHY = "Only a part's knobs can be mapped";

/** The refusal on a knob a macro mapping holds. */
export const macroHeldWhy = (macro: string): string => `Mapped by the macro ${macro}`;

export const LEARN_LABEL = 'Learn MIDI CC…';
export const EDIT_LABEL = 'Edit mapping…';
export const removeLabel = (cc: number): string => `Remove CC ${cc}`;

/** What the menu is built from. */
export interface KnobCcMenuQuery {
  readonly at: KnobCcAt;
  /** The part at `at.part`, or undefined for a knob no part owns. */
  readonly part: DocumentPart | undefined;
  /** The part's patch, which names its macros. */
  readonly patch: Patch | undefined;
  /** The knob's lock now: a macro's holds it against learn. */
  readonly lock: KnobAutomation | null;
  /** The knob's own label, the head where no row names the target. */
  readonly label: string;
}

const item = (
  action: KnobCcAction,
  label: string,
  tag: string | null = null,
  refused: string | null = null,
): KnobCcMenuItem => ({ action, label, tag, refused, danger: action === 'remove' });

/** Learn's refusal and tag on `part`'s `target`, unmapped or `mapped` to CC `cc`. */
function learnItem(query: KnobCcMenuQuery, cc: number | undefined): KnobCcMenuItem {
  const { part, lock, at } = query;
  if (!part) return item('learn', LEARN_LABEL, NOT_A_PART_WHY, NOT_A_PART_WHY);
  if (lock?.macro !== undefined) {
    const why = macroHeldWhy(lock.macro);
    return item('learn', LEARN_LABEL, why, why);
  }
  if (cc !== undefined) return item('learn', LEARN_LABEL, `replaces CC ${cc}`);
  if (targetKind(at.target) !== 'voice') return item('learn', LEARN_LABEL);
  const held = voiceSlotTargets(part);
  if (held.has(voicePathOf(at.target) ?? '')) return item('learn', LEARN_LABEL);
  if (held.size >= FM_LANES_MAX) return item('learn', LEARN_LABEL, slotsFullWhy(), slotsFullWhy());
  const used = held.size;
  return item('learn', LEARN_LABEL, `Voice ${used}/${FM_LANES_MAX} → ${used + 1}/${FM_LANES_MAX}`);
}

/**
 * The knob's menu, or null where the browser's own menu stays: a target a
 * CC can't move, or one its part does not hold.
 */
export function knobCcMenu(query: KnobCcMenuQuery): KnobCcMenu | null {
  const { at, part, patch, label } = query;
  if (!isCcMappableTarget(at.target)) return null;
  if (!part) return { head: label, items: [learnItem(query, undefined)] };
  const row = laneRow(part, at.target, patch);
  if (!row) return null;
  const cc = part.ccMappings?.find((m) => m.target === at.target)?.source.cc;
  const learn = learnItem(query, cc);
  if (cc === undefined) return { head: row.label, items: [learn] };
  return {
    head: `${row.label} · CC ${cc}`,
    items: [learn, item('edit', EDIT_LABEL), item('remove', removeLabel(cc))],
  };
}
