/**
 * The Sequencers tab's arp card (#70): the arpeggiator's knobs, its walk mode,
 * the step divisor and capture-to-fixed (record §6). No strip — an arp draws
 * its notes from the key rather than from written steps, so there is nothing
 * to lay out per step and no playhead to follow. The knob specs are
 * `sequencerKnobTables.ts`; the card registry is `sequencerCards.ts`.
 */
import {
  ARP_WALK_MODES,
  DEFAULT_ARPEGGIATOR_CONFIG,
} from '../../../packages/client/src/audio/index-for-editor';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, seg } from './dom';
import { captureControls, divisorPicker, driverOf, knobRow } from './seqFields';
import { ARP_KNOBS } from './sequencerKnobTables';

/** The card body for an `arp` part. */
export function arpCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, slot, ARP_KNOBS, PITCH_COLOR));
  body.appendChild(el('span', 'field-label', 'Walk'));
  body.appendChild(
    seg(
      ARP_WALK_MODES.map((w) => ({ value: w, label: w })),
      () => {
        const spec = driverOf(ctx.model.doc, slot);
        return spec?.kind === 'arp' ? spec.walk : DEFAULT_ARPEGGIATOR_CONFIG.walk;
      },
      (w) => void ctx.change(partChange(slot, { sequencer: { walk: w } })),
      PITCH_COLOR,
    ),
  );
  body.appendChild(divisorPicker(ctx, slot));
  body.appendChild(captureControls(ctx, slot, PITCH_COLOR));
  return body;
}
