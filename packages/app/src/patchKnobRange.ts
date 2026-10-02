/**
 * A Parts-tab knob's range from the automation catalog (windsor#436, record
 * `2026-10-02-knob-ranges-from-the-catalog`): a knob over a voice target
 * takes its bounds and its scale from the target's catalog row, so the knob
 * and the lane that locks it cannot disagree. The knob table keeps only
 * what the catalog does not know: the label, the step and the readout.
 */
import type { AutomationTargetRow, VoiceTargetPath } from '@windsor/engine';
import { catalogRow, voiceTargetId } from '@windsor/engine';
import type { KnobSpec } from './knob';

/** The part of a knob's spec a catalog row decides. */
export type CatalogKnobRange = Pick<KnobSpec, 'min' | 'max' | 'curve' | 'logFloor'>;

/**
 * A knob range from a catalog row: its bounds, a log knob for any row not
 * drawn linear (cutoff's octaves, resonance's log), and the row's display
 * floor as the log knob's floor where the row has one (a decay time from 0).
 */
export function knobRangeOf(row: AutomationTargetRow): CatalogKnobRange {
  const bounds = { min: row.min, max: row.max };
  if (row.scale === 'linear') return bounds;
  return row.floor === undefined
    ? { ...bounds, curve: 'log' }
    : { ...bounds, curve: 'log', logFloor: row.floor };
}

/** The knob range of the voice target at `path`. Throws on a path the catalog has no row for. */
export function voiceKnobRange(path: VoiceTargetPath): CatalogKnobRange {
  const row = catalogRow(voiceTargetId(path));
  if (!row) throw new Error(`patchKnobRange: no voice target at ${path}`);
  return knobRangeOf(row);
}
