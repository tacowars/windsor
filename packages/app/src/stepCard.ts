/**
 * The Sequencers tab's step card (#70): the step sequencer's knobs, the step
 * divisor and capture-to-fixed (record §6). No strip — a `step` part draws its
 * notes from the key at the divisor rather than from written steps, so there
 * is nothing to lay out per step and no playhead to follow. The knob specs are
 * `sequencerKnobTables.ts`; the card registry is `sequencerCards.ts`.
 */
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el } from './dom';
import { captureControls, divisorPicker, knobRow } from './seqFields';
import { STEP_KNOBS } from './sequencerKnobTables';

/** The card body for a `step` part. */
export function stepCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, slot, STEP_KNOBS, PITCH_COLOR));
  body.appendChild(divisorPicker(ctx, slot));
  body.appendChild(captureControls(ctx, slot, PITCH_COLOR));
  return body;
}
