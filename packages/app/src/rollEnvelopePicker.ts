/**
 * The Roll's envelope picker, without the DOM (windsor#707 decisions 4 and
 * 5; epic windsor#699 decision 6): which voice targets it offers, in the
 * Song tab's voice sections (`pickerGroups`), which it marks and lists
 * first, which it disables, and the envelope list an add, a switch or a
 * delete leaves.
 *
 * The limits:
 * - at most `ROLL_ENVELOPES_MAX` envelopes; once at the cap every target
 *   without one is disabled;
 * - the part's voice slots stay within `FM_LANES_MAX`: the distinct voice
 *   targets across its song voice lanes and the envelopes of every roll
 *   pattern it holds (`partVoiceSlots.ts`, the count the Song tab's picker
 *   reads too). A target already in that set holds its slot, which an
 *   envelope on it shares, so it stays open when the slots are full; any
 *   other is disabled.
 *
 * Every edit returns the roll's whole new list, since a merge replaces an
 * array wholesale.
 */
import type { DocumentPart, Patch, RollEnvelope, VoiceTargetPath } from '@windsor/engine';
import {
  FM_LANES_MAX,
  ROLL_ENVELOPES_MAX,
  isVoiceTargetPath,
  targetKind,
  voicePathOf,
} from '@windsor/engine';
import { pickerGroups } from './songAutomationModel';
import type { VoiceSlotPart } from './partVoiceSlots';
import { laneVoicePaths, voiceSlotTargets } from './partVoiceSlots';

/** One voice target the picker can list. */
export interface EnvelopeTarget {
  readonly path: VoiceTargetPath;
  readonly label: string;
}

/** One of the Song tab's voice sections: "Voice · Filter", "Macros". */
export interface EnvelopeTargetGroup {
  readonly label: string;
  readonly targets: readonly EnvelopeTarget[];
}

/** A target that holds an envelope: listed first, in the roll's order. */
export interface MarkedTarget extends EnvelopeTarget {
  readonly on: boolean;
  /** The envelope drawn over the notes. */
  readonly shown: boolean;
}

/** Why a target without an envelope can't take one. */
export type PickerRefusal = 'envFull' | 'slotsFull';

/** A target without an envelope. */
export interface OpenTarget extends EnvelopeTarget {
  /** It has a song lane on the part, whose slot an envelope would share. */
  readonly lane: boolean;
  readonly refused: PickerRefusal | null;
}

/** The picker as the list draws it. */
export interface EnvelopePicker {
  readonly envelopes: number;
  readonly envelopesMax: number;
  /** The part's voice slots: its song voice lanes' and every roll pattern's envelopes' targets. */
  readonly slots: number;
  readonly slotsMax: number;
  readonly envFull: boolean;
  readonly slotsFull: boolean;
  readonly marked: readonly MarkedTarget[];
  readonly groups: readonly { readonly label: string; readonly targets: readonly OpenTarget[] }[];
}

/** What the picker is worked out from. */
export interface PickerInput {
  readonly groups: readonly EnvelopeTargetGroup[];
  /** This roll's envelopes, as the document holds them. */
  readonly envelopes: readonly RollEnvelope[];
  /** The part, whose song lanes and roll patterns hold its voice slots; none holds none. */
  readonly part: VoiceSlotPart | undefined;
  /** The target whose envelope is shown, if any. */
  readonly shown: string | null;
  readonly envelopesMax?: number;
  readonly slotsMax?: number;
}

/** The Song tab's voice sections for `part`, macros named as `patch` names them, and nothing else. */
export function voiceTargetGroups(part: DocumentPart, patch?: Patch): EnvelopeTargetGroup[] {
  return pickerGroups(part, patch).flatMap((group) => {
    const targets = group.options.flatMap((option) => {
      if (targetKind(option.target) !== 'voice') return [];
      const path = voicePathOf(option.target);
      return isVoiceTargetPath(path) ? [{ path, label: option.label }] : [];
    });
    return targets.length > 0 ? [{ label: group.label, targets }] : [];
  });
}

/** The name the picker gives `path`: its label in `groups`, else the path itself. */
export function targetName(groups: readonly EnvelopeTargetGroup[], path: string): string {
  for (const group of groups) {
    const found = group.targets.find((target) => target.path === path);
    if (found) return found.label;
  }
  return path;
}

/** The section `path` sits in, which the column shows under the picker; '' when none lists it. */
export function targetSection(groups: readonly EnvelopeTargetGroup[], path: string): string {
  return groups.find((group) => group.targets.some((t) => t.path === path))?.label ?? '';
}

/** The picker over `input`: the marked targets first, then each section's other targets. */
export function envelopePicker(input: PickerInput): EnvelopePicker {
  const { groups, envelopes, part, shown } = input;
  const envelopesMax = input.envelopesMax ?? ROLL_ENVELOPES_MAX;
  const slotsMax = input.slotsMax ?? FM_LANES_MAX;
  const lanes = part ? laneVoicePaths(part) : new Set<string>();
  const slotted = part ? voiceSlotTargets(part) : new Set<string>();
  const slots = slotted.size;
  const envFull = envelopes.length >= envelopesMax;
  const slotsFull = slots >= slotsMax;
  const held = new Set<string>(envelopes.map((envelope) => envelope.target));
  const marked = envelopes.map((envelope) => ({
    path: envelope.target,
    label: targetName(groups, envelope.target),
    on: envelope.on,
    shown: envelope.target === shown,
  }));
  const refusal = (path: string): PickerRefusal | null =>
    envFull ? 'envFull' : slotsFull && !slotted.has(path) ? 'slotsFull' : null;
  const open = groups.flatMap((group) => {
    const targets = group.targets
      .filter((target) => !held.has(target.path))
      .map((target) => {
        return { ...target, lane: lanes.has(target.path), refused: refusal(target.path) };
      });
    return targets.length > 0 ? [{ label: group.label, targets }] : [];
  });
  return {
    envelopes: envelopes.length,
    envelopesMax,
    slots,
    slotsMax,
    envFull,
    slotsFull,
    marked,
    groups: open,
  };
}

/** The envelope drawn over the notes: the chosen target's, else the roll's first, else none. */
export function shownEnvelope(
  envelopes: readonly RollEnvelope[],
  chosen: string | null,
): RollEnvelope | null {
  return envelopes.find((envelope) => envelope.target === chosen) ?? envelopes[0] ?? null;
}

/** The list with an empty envelope on `path` added at its end, switched on: its flat 0 line. */
export const withEnvelope = (
  envelopes: readonly RollEnvelope[],
  path: VoiceTargetPath,
): RollEnvelope[] => [...envelopes, { target: path, on: true, points: [] }];

/** The list with `path`'s envelope switched on or off. */
export const switchedEnvelope = (
  envelopes: readonly RollEnvelope[],
  path: string,
): RollEnvelope[] =>
  envelopes.map((envelope) =>
    envelope.target === path ? { ...envelope, on: !envelope.on } : envelope,
  );

/** The list without `path`'s envelope. */
export const withoutEnvelope = (envelopes: readonly RollEnvelope[], path: string): RollEnvelope[] =>
  envelopes.filter((envelope) => envelope.target !== path);
