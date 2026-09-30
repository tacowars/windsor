/**
 * What a send bus's head says about who feeds it (windsor#172; the mockup's
 * `.bus-sub`, `docs/research/2026-09-30-insert-rack/mockup.html`): the parts
 * whose send to the bus is above zero, in slot order. Pure, over the
 * normalised document.
 */
import type { ArrangementDocument, ReturnName } from '@windsor/engine';

/** The names of the parts that send to `bus`, in slot order. */
export function busSenders(doc: ArrangementDocument, bus: ReturnName): string[] {
  return [...doc.parts]
    .sort((a, b) => a.slot - b.slot)
    .filter((part) => (part.strip.sends[bus] ?? 0) > 0)
    .map((part) => part.name);
}

/** The bus head's line under its Level knob. */
export function busSendersLine(senders: readonly string[]): string {
  return senders.length ? `Sends from ${senders.join(', ')}` : 'No part sends here yet';
}
