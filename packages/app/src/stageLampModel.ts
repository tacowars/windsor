/**
 * The stage lamp's rules (windsor#194 decision 5; record
 * `2026-09-30-master-column-and-meters`, decision 6): amber while the output
 * stage has acted within `OUTPUT_LIGHT_HOLD_MS`, red while the watch is
 * latched, and a name. Latched, the name is the latching report's action,
 * so a mode change before the lamp is cleared keeps it; unlatched, it is the
 * current mode's action. The title says what a click does. Values in, values
 * out; `stageLamp.ts` draws what this returns.
 */
import type { OutputStageMode } from '@windsor/engine';
import type { OutputStageAction } from './outputStageModel';
import {
  OUTPUT_ACTION_EVENTS,
  OUTPUT_LIGHT_HOLD_MS,
  OUTPUT_MODE_ACTIONS,
} from './outputStageTables';

/** The slice of the stage's watch (`outputStageWatch.ts`) the lamp reads. */
export interface LampWatch {
  readonly latchedAction: OutputStageAction | null;
  readonly lastActedMs: number | null;
}

export interface StageLampView {
  /** The stage acted within the hold: lit amber (red while latched). */
  readonly lit: boolean;
  /** The watch is latched: red until clicked. */
  readonly latched: boolean;
  readonly label: OutputStageAction;
  readonly title: string;
}

/** The lamp for `mode` and the watch's state (`null`: no live stage) at `nowMs`. */
export function stageLampView(
  mode: OutputStageMode,
  watch: LampWatch | null,
  nowMs: number,
  holdMs: number = OUTPUT_LIGHT_HOLD_MS,
): StageLampView {
  const lastActedMs = watch?.lastActedMs ?? null;
  const lit = lastActedMs !== null && nowMs - lastActedMs < holdMs;
  const latchedAction = watch?.latchedAction ?? null;
  if (latchedAction !== null) {
    return {
      lit,
      latched: true,
      label: latchedAction,
      title: `${latchedAction} since the last clear. Click to clear the lamp.`,
    };
  }
  const label = OUTPUT_MODE_ACTIONS[mode];
  return {
    lit,
    latched: false,
    label,
    title: `Lights when ${OUTPUT_ACTION_EVENTS[label]}, and stays red until clicked.`,
  };
}
