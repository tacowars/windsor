/**
 * A mapping's Range cell, without the DOM (windsor#784, record
 * `2026-10-13-midi-cc-mapping` decision 5 and the mockup): each end is
 * dragged like a knob, along the target's own scale (a lane's display
 * space, so a cutoff moves in octaves and the strip's Level in dB), or
 * typed in the units its readout shows (`automationReadout.ts`): "2.5 kHz",
 * "-6 dB", "300 ms", "L40".
 */
import type { AutomationTargetRow } from '@windsor/engine';
import { fromDisplay, toDisplay } from '@windsor/engine';

import { DRAG_RANGE_FINE_PX, DRAG_RANGE_PX } from './knobConstants';
import { READOUT_NUMBERS, type ReadoutNumbers } from './songAutomationTables';

const clamp = (row: AutomationTargetRow, value: number): number =>
  Math.min(row.max, Math.max(row.min, value));

/**
 * The value an end dragged from `start` reaches after `dy` pixels (down is
 * positive, so up raises it): the knob's travel, `DRAG_RANGE_PX` for the
 * row's whole height, or `DRAG_RANGE_FINE_PX` with Shift.
 */
export function draggedValue(
  row: AutomationTargetRow,
  start: number,
  dy: number,
  fine: boolean,
): number {
  const travel = fine ? DRAG_RANGE_FINE_PX : DRAG_RANGE_PX;
  const y = Math.min(1, Math.max(0, toDisplay(row, start) - dy / travel));
  return clamp(row, fromDisplay(row, y));
}

/** A number and the letters after it: "2.5 kHz" → [2.5, 'khz']. */
function numberAndUnit(text: string): readonly [number, string] | undefined {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z%°]*)$/.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? [value, match[2] ?? ''] : undefined;
}

/** A pan typed as the readout shows it: C, L40, R25, or a number in −1..1. */
function panValue(text: string, n: ReadoutNumbers): number | undefined {
  if (text === 'c') return 0;
  const side = /^([lr])\s*(\d+\.?\d*)$/.exec(text);
  if (side) return ((side[1] === 'l' ? -1 : 1) * Number(side[2])) / n.panScale;
  return numberAndUnit(text)?.[0];
}

/** A level typed in dB, the strip's Level's own units: −∞ (or "-inf") is silence. */
function gainValue(row: AutomationTargetRow, text: string, n: ReadoutNumbers): number | undefined {
  if (/^-\s*(inf|∞)/.test(text)) return row.min;
  const parsed = numberAndUnit(text);
  return parsed && Math.exp((parsed[0] / n.dbPerDecade) * Math.LN10);
}

/** A number in the row's units, a unit that scales it ("k", "ms") applied. */
function unitValue(row: AutomationTargetRow, text: string, n: ReadoutNumbers): number | undefined {
  const parsed = numberAndUnit(text);
  if (!parsed) return undefined;
  const [value, unit] = parsed;
  if (row.unit === 'Hz' && unit.startsWith('k')) return value * n.kiloHz;
  if (row.unit === 's' && unit === 'ms') return value / n.msPerSecond;
  return value;
}

/** What a typed end means in `row`'s units, clamped to the row; undefined when it reads as nothing. */
export function parseRangeText(
  row: AutomationTargetRow,
  typed: string,
  n: ReadoutNumbers = READOUT_NUMBERS,
): number | undefined {
  const text = typed.trim().toLowerCase().replace('−', '-');
  let value: number | undefined;
  if (row.target === 'strip.pan') value = panValue(text, n);
  else if (row.scale === 'db') value = gainValue(row, text, n);
  else value = unitValue(row, text, n);
  return value === undefined || !Number.isFinite(value) ? undefined : clamp(row, value);
}
