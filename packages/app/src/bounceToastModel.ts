/**
 * Bounce to Roll's toasts (windsor#742, record `2026-10-11-bounce-to-roll`
 * decisions 6 and 8): the sentences built from the engine's summary or
 * refusal. The engine hands data only; the words are the console's.
 *
 * Success: "Bounced to Roll: 24 notes in 2 regions", then only the counts
 * that are not zero, " · "-separated in decision 8's order, then a line per
 * Figure part whose canon lost its leader. Refusal: which region, what it
 * needs, the cap, and "Split it first."
 */
import type { BounceRefusal, BounceSummary, SeqField } from '@windsor/engine';
import { ROLL_LOOP_TICKS_MAX, ROLL_NOTES_MAX, ticksPerBar } from '@windsor/engine';
import type { CountWords } from './bounceTables';
import {
  BOUNCE_CAP_METER,
  BOUNCE_COUNT_LINES,
  BOUNCE_LANE_NAMES,
  BOUNCE_TOAST,
} from './bounceTables';

/** "1 note", "24 notes". */
function counted(count: number, words: CountWords): string {
  return `${count} ${count === 1 ? words.one : words.many}`;
}

/** "Skip", "Skip and Gate", "Skip, Gate and Density". */
function joinNames(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Skip and Gate lanes baked", in the table's order; null when no lane was baked. */
function lanesLine(baked: readonly SeqField[]): string | null {
  const names = BOUNCE_LANE_NAMES.filter(([field]) => baked.includes(field)).map(([, n]) => n);
  if (names.length === 0) return null;
  return `${joinNames(names)} lane${names.length === 1 ? '' : 's'} baked`;
}

/** The success toast's text. */
export function bounceSuccessText(summary: BounceSummary): string {
  const head =
    `${BOUNCE_TOAST.bounced}: ${counted(summary.notes, BOUNCE_TOAST.note)} ` +
    `in ${counted(summary.regions, BOUNCE_TOAST.region)}`;
  const counts = BOUNCE_COUNT_LINES.filter(([key]) => summary[key] !== 0).map(([key, words]) =>
    counted(summary[key], words),
  );
  const lanes = lanesLine(summary.lanesBaked);
  const canons = summary.followers.map((f) => `${f.name}'s canon lost its leader`);
  return [head, ...counts, ...(lanes ? [lanes] : []), ...canons].join(BOUNCE_TOAST.separator);
}

/** The error toast's text: what the region needs past the Roll's cap. */
export function bounceRefusalText(refusal: BounceRefusal): string {
  const region = `Region ${refusal.region}`;
  if (refusal.cap === 'notes') {
    return (
      `${region} needs ${refusal.notes} notes; a Roll region holds ${ROLL_NOTES_MAX}. ` +
      BOUNCE_TOAST.splitFirst
    );
  }
  const capBars = ROLL_LOOP_TICKS_MAX / ticksPerBar(BOUNCE_CAP_METER);
  return (
    `${region} needs a ${refusal.bars}-bar loop; ` +
    `a Roll loops at most ${capBars} bars of ${BOUNCE_CAP_METER}. ${BOUNCE_TOAST.splitFirst}`
  );
}
