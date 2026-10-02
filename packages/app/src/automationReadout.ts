/**
 * What an automation target's value reads as, in its catalog row's units
 * (windsor#348; record `2026-10-01-song-automation-lanes`): a song lane's
 * mixer cell, the shape popover, and a step lane's played value
 * (windsor#424), so a target reads the same wherever it shows. The number
 * rules are `songAutomationTables.ts`'s `READOUT_NUMBERS`.
 */
import type { AutomationTargetRow } from '@windsor/engine';
import { fmtVowel } from './consoleFormat';
import { READOUT_NUMBERS, type ReadoutNumbers } from './songAutomationTables';

/** `value` with its sign, a value that rounds to zero as +0 (never "-0.0"). */
const signed = (value: number, decimals: number): string => {
  const shown = Number(value.toFixed(decimals)) || 0;
  return `${shown >= 0 ? '+' : ''}${shown.toFixed(decimals)}`;
};

/** A plain number with fewer decimals as it grows. */
function plain(value: number, n: ReadoutNumbers): string {
  const size = Math.abs(value);
  if (size >= n.wholeFrom) return value.toFixed(0);
  return value.toFixed(size >= n.oneDecimalFrom ? 1 : 2);
}

function hz(value: number, n: ReadoutNumbers): string {
  if (value >= n.kiloHz) return `${(value / n.kiloHz).toFixed(2)} kHz`;
  return `${plain(value, n)} Hz`;
}

function pan(value: number, n: ReadoutNumbers): string {
  const amount = Math.round(Math.abs(value) * n.panScale);
  if (amount === 0) return 'C';
  return `${value < 0 ? 'L' : 'R'}${amount}`;
}

/** A level lane's linear gain in dB, "-∞ dB" at or under its floor. */
function gainDb(row: AutomationTargetRow, value: number, n: ReadoutNumbers): string {
  if (value <= (row.floor ?? 0)) return '-∞ dB';
  return `${signed(n.dbPerDecade * Math.log10(value), 1)} dB`;
}

/** The Formant vowel's target, which reads as the Parts tab's Vowel knob. */
const VOWEL_TARGET = 'voice.filter.vowel';

/** What a target's value reads, in its row's units. */
export function readout(
  row: AutomationTargetRow,
  value: number,
  n: ReadoutNumbers = READOUT_NUMBERS,
): string {
  switch (row.unit) {
    case 'dB':
      return row.scale === 'db' ? gainDb(row, value, n) : `${signed(value, 1)} dB`;
    case 'Hz':
      return hz(value, n);
    case 's':
      return value < n.secondsAsMsBelow
        ? `${(value * n.msPerSecond).toFixed(0)} ms`
        : `${value.toFixed(2)} s`;
    case 'oct':
    case 'st':
      return `${signed(value, 1)} ${row.unit}`;
    case '%':
    case '°':
      return `${value.toFixed(0)}${row.unit}`;
    case '':
      if (row.target === 'strip.pan') return pan(value, n);
      // The Formant vowel reads as its knob does (windsor#406): "a", "o→u 25%".
      return row.target === VOWEL_TARGET ? fmtVowel(value) : plain(value, n);
    default:
      return `${plain(value, n)} ${row.unit}`;
  }
}
