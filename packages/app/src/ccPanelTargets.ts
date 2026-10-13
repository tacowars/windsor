/**
 * "+ Add mapping"'s target list, without the DOM (windsor#784, record
 * `2026-10-13-midi-cc-mapping` decisions 6, 8 and 12): the Song tab's lane
 * picker (`pickerGroups`), grouped Mixer, Inserts, Voice and Macros, less what
 * a CC cannot move (an insert's switch, the sequencer's rows), which
 * `isCcMappableTarget` rules out, and less what a macro maps, which the lane
 * picker leaves out already.
 *
 * - **The voice count** is the part's voice slots against eight
 *   (`partVoiceSlots.ts`), its CC mappings included. Once full, a voice
 *   target or macro outside them is disabled, titled "Voice slots full
 *   (8/8)"; one already holding a slot stays open.
 * - **Tags.** A mapped target reads "CC 91 · replace", since picking it
 *   learns its source again (decision 10). A lane on the target reads
 *   "lane on" or "lane off", or with a mapping "lane · CC 75".
 * - Unlike the lane picker, a target with a lane stays open: a lane and a CC
 *   may share a target (decision 3).
 */
import type { CcTargetId, DocumentPart, Patch } from '@windsor/engine';
import { FM_LANES_MAX, isCcMappableTarget, targetKind, voicePathOf } from '@windsor/engine';

import { voiceSlotTargets } from './partVoiceSlots';
import { pickerGroups } from './songAutomationModel';

/** One target in the list. */
export interface CcTargetOption {
  readonly target: CcTargetId;
  readonly label: string;
  readonly tag: string;
  /** Why it can't be picked, or null when it can. */
  readonly refused: string | null;
}

export interface CcTargetGroup {
  readonly label: string;
  readonly options: readonly CcTargetOption[];
}

/** The list: its groups, and the part's voice slots against eight. */
export interface CcTargetList {
  readonly groups: readonly CcTargetGroup[];
  readonly used: number;
  readonly max: number;
  readonly full: boolean;
}

/** "Voice 5/8". */
export const ccVoiceCount = (used: number, max = FM_LANES_MAX): string => `Voice ${used}/${max}`;

/** The title of a target refused for the voice's slots. */
export const slotsFullWhy = (max = FM_LANES_MAX): string => `Voice slots full (${max}/${max})`;

/** A target's tag: its mapping's CC and its lane, as the list shows them. */
function tagOf(part: DocumentPart, target: CcTargetId): string {
  const cc = part.ccMappings?.find((m) => m.target === target)?.source.cc;
  const lane = part.automation?.find((l) => l.target === target);
  if (cc !== undefined && lane) return `lane · CC ${cc}`;
  if (cc !== undefined) return `CC ${cc} · replace`;
  if (lane) return lane.on ? 'lane on' : 'lane off';
  return '';
}

/** The targets `part`, playing `patch`, offers a new mapping. */
export function ccTargetList(part: DocumentPart, patch: Patch | undefined): CcTargetList {
  const held = voiceSlotTargets(part);
  const full = held.size >= FM_LANES_MAX;
  const refusedFor = (target: CcTargetId): string | null => {
    if (!full || targetKind(target) !== 'voice') return null;
    return held.has(voicePathOf(target) ?? '') ? null : slotsFullWhy();
  };
  const groups = pickerGroups(part, patch).flatMap((group) => {
    const options = group.options.flatMap((option) => {
      const target = option.target;
      if (!isCcMappableTarget(target)) return [];
      return [
        { target, label: option.label, tag: tagOf(part, target), refused: refusedFor(target) },
      ];
    });
    return options.length > 0 ? [{ label: group.label, options }] : [];
  });
  return { groups, used: held.size, max: FM_LANES_MAX, full };
}
