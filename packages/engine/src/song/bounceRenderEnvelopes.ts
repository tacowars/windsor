/**
 * Bounce to Roll's envelopes (windsor#740, record `2026-10-11-bounce-to-roll`
 * decision 4, "Step-mod lanes", and "What an envelope is not"): a part's
 * step offsets, which ride on each note-on, as clip envelopes on the same
 * voice targets.
 *
 * Each row is read from the written notes' `stepMod` arrays, 0 on a note
 * with none, and a row that is 0 on every note is not written. Its value
 * changes only at onsets: each onset takes its note's value and holds it
 * to the next. An envelope's ticks strictly increase, so a change is two
 * points, the old value `BOUNCE_ENVELOPE_STEP_TICKS` before the onset and
 * the new one on it, both straight; the first onset is one point. Notes on
 * one tick come from one event, so the first of them speaks for the tick.
 */
import { BOUNCE_ENVELOPE_STEP_TICKS } from './bounceRenderTables';
import type { RollEnvelope, RollEnvelopePoint } from '../sequencing/rollEnvelope';
import { VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';

/** What an envelope reads of a note: its onset and its step's offsets. */
export interface StepModOnset {
  readonly tick: number;
  readonly stepMod: readonly number[] | undefined;
}

/** The rows some onset moves, in table order. */
function movedRows(onsets: readonly StepModOnset[]): number[] {
  const rows = new Set<number>();
  for (const { stepMod } of onsets) {
    stepMod?.forEach((value, row) => {
      if (value !== 0) rows.add(row);
    });
  }
  return [...rows].sort((a, b) => a - b);
}

/** One onset per tick, the first note's, in tick order. */
function firstPerTick(onsets: readonly StepModOnset[]): StepModOnset[] {
  const out: StepModOnset[] = [];
  for (const onset of onsets) {
    if (out[out.length - 1]?.tick !== onset.tick) out.push(onset);
  }
  return out;
}

function pointsOf(onsets: readonly StepModOnset[], row: number, step: number): RollEnvelopePoint[] {
  const points: RollEnvelopePoint[] = [];
  let last: number | null = null;
  for (const { tick, stepMod } of onsets) {
    const value = stepMod?.[row] ?? 0;
    if (last === null) points.push({ tick, value, bend: 0 });
    else if (value !== last) {
      points.push({ tick: tick - step, value: last, bend: 0 }, { tick, value, bend: 0 });
    }
    last = value;
  }
  return points;
}

/** The step-mod rows of `notes` (sorted by tick) as clip envelopes, one per row that moves. */
export function stepModEnvelopes(
  notes: readonly StepModOnset[],
  step = BOUNCE_ENVELOPE_STEP_TICKS,
): RollEnvelope[] {
  const onsets = firstPerTick(notes);
  return movedRows(onsets).map((row) => ({
    target: VOICE_TARGET_PATHS[row]!,
    on: true,
    points: pointsOf(onsets, row, step),
  }));
}
