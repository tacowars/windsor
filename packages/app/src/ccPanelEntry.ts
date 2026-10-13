/**
 * The ways into the MIDI CC panel from outside it (windsor#784, record
 * `2026-10-13-midi-cc-mapping` decision 12): the part bar's MIDI CC button,
 * and, for a knob's right-click menu on any tab, "Edit mapping…" (the panel
 * opened at a mapping's row) and "Learn MIDI CC…" (learn started for a
 * target). A settable entry, as the gesture hook is (`gestureHooks.ts`): a
 * control with no panel in scope reaches it here, and each call does nothing
 * until `mountCcPanel` sets it.
 */
import type { CcTargetId } from '@windsor/engine';

export interface CcPanelEntry {
  /** A MIDI CC button for the part bar, which is rebuilt whole: a new one each call. */
  button(): HTMLElement;
  /** Open the panel at the mapping on `target` of the part on `part`. */
  openAt(part: number, target: CcTargetId): void;
  /** Open the panel and start learn for `target` of the part on `part`. */
  learnFor(part: number, target: CcTargetId): void;
}

let entry: CcPanelEntry | null = null;

/** Point the ways in at the console's panel (`mountCcPanel`), or back at nothing. */
export function setCcPanelEntry(next: CcPanelEntry | null): void {
  entry = next;
}

/** The part bar's MIDI CC button, or nothing before the panel is mounted. */
export const ccPanelButton = (): HTMLElement[] => (entry ? [entry.button()] : []);

/** "Edit mapping…": the panel, open at the row of the mapping on `target` of `part`. */
export function openCcMapping(part: number, target: CcTargetId): void {
  entry?.openAt(part, target);
}

/** "Learn MIDI CC…": the panel, listening for a knob to map to `target` of `part`. */
export function learnCcMapping(part: number, target: CcTargetId): void {
  entry?.learnFor(part, target);
}
