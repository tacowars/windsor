/**
 * What a CC mapping's row says (windsor#783, record
 * `2026-10-13-midi-cc-mapping` decision 12): one status per mapping, from
 * what the engine returned, the lane on its target, the patch's macros and
 * the mapping's pickup. The panel draws the row's live value cell from it
 * alone: a value, or one of the statuses with its words.
 *
 * Inert comes first, then Automated, then No voice slot, then Waiting for
 * pickup or the live value. A mapping is inert (decision 10) on a macro the
 * patch does not define ("no Macro 2 in this patch"), on a voice target one
 * of the patch's macros maps ("mapped by Accent"), or on a target its part
 * does not hold.
 */
import {
  type CcTargetId,
  type Patch,
  catalogRow,
  effectiveMacroMappings,
  macroIndexOf,
  targetKind,
  voicePathOf,
} from '@windsor/engine';

import type { CcApplyResult } from './ccEngine';

/** The hardware position a mapping waiting for pickup heard last: its hollow marker. */
export interface CcMarker {
  /** The controller value, 0–127. */
  readonly cc: number;
  /** The target's value at that position, in its own units, where the marker sits on the ring. */
  readonly value: number;
}

export type CcStatus =
  /** The value playing, in the target's units: the CC's (`held`) or the target's own. */
  | { readonly kind: 'live'; readonly value: number; readonly held: boolean }
  /** Pickup armed; the marker is null until the hardware position is heard. */
  | { readonly kind: 'waiting'; readonly marker: CcMarker | null }
  | { readonly kind: 'automated' }
  | { readonly kind: 'inert'; readonly reason: string }
  | { readonly kind: 'noSlot' };

/** A status's words in the row: null for a live value, which the panel formats in the target's units. */
export function ccStatusText(status: CcStatus): string | null {
  switch (status.kind) {
    case 'live':
      return null;
    case 'waiting':
      return 'Waiting for pickup';
    case 'automated':
      return 'Automated';
    case 'inert':
      return `Inert · ${status.reason}`;
    case 'noSlot':
      return 'No voice slot';
  }
}

/** A macro's name in `patch`, or the catalog's `Macro <n>` where it has none. */
function macroLabel(patch: Patch | undefined, index: number, path: string): string {
  const name = patch?.macros[index]?.name.trim();
  return name ? name : (catalogRow(`voice.${path}`)?.label ?? path);
}

/** The catalog path of macro `index`'s row. */
const macroPath = (index: number): string => `macros.${index}.value`;

/**
 * Why a mapping on `target` cannot play on a part playing `patch`, or
 * undefined when it can: a macro `patch` does not define, or a voice target
 * one of its macros maps. Strip and insert targets are never inert here.
 */
export function ccInertReason(patch: Patch | undefined, target: CcTargetId): string | undefined {
  const path = voicePathOf(target);
  if (path === undefined) return undefined;
  const macro = macroIndexOf(path);
  if (macro >= 0) {
    return patch?.macros[macro]
      ? undefined
      : `no ${macroLabel(undefined, macro, path)} in this patch`;
  }
  const mappedBy = effectiveMacroMappings(patch).find(({ mapping }) => mapping.target === path);
  return mappedBy && `mapped by ${macroLabel(patch, mappedBy.macro, macroPath(mappedBy.macro))}`;
}

/** The reason a mapping whose target its part does not hold is inert. */
export const CC_NOT_IN_PART = 'not in this part';

/** The reason an insert target the engine refused is inert: its current settings lack it. */
export const CC_NOT_IN_MODE = "not available in this insert's current mode";

/**
 * The status a value the engine did not apply leaves on its row, or
 * undefined when it applied or audio is off (the next value tries again).
 * The engine gives no reason for `inert`, so an insert target reads its
 * mode's, and any other the part's.
 */
export function ccRefusedStatus(result: CcApplyResult, target: CcTargetId): CcStatus | undefined {
  switch (result) {
    case 'applied':
    case 'off':
      return undefined;
    case 'noSlot':
    case 'automated':
      return { kind: result };
    case 'inert':
      return {
        kind: 'inert',
        reason: targetKind(target) === 'insert' ? CC_NOT_IN_MODE : CC_NOT_IN_PART,
      };
  }
}
