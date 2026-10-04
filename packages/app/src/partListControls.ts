/**
 * The part half of the Parts tab's bar (#598; the bar, windsor#521): rename
 * the selected part and choose its sequencer. Adding and removing a part
 * moved to the header's part strip (windsor#520, `partStrip.ts`). A kind
 * change is a live edit through `partEdits.ts` — a sequencer spec at the
 * kind's defaults — so the transport and the other parts play on; a rename
 * is a live label change. Everything addresses the part by slot.
 */
import type { SequencerKind } from '@windsor/engine';
import { SEQUENCER_KINDS, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { KIND_LABELS } from './sequencerConstants';
import { setSequencerKindLive } from './partEdits';
import { partNameField } from './partNameField';

/** The sequencer as a select reading `Seq: <kind>`; a change rebuilds that part alone at the kind's defaults. */
function kindPicker(ctx: AppCtx, slot: number): HTMLSelectElement {
  const picker = document.createElement('select');
  picker.className = 'field bar-seq';
  picker.name = `part-sequencer-${slot}`;
  picker.title = 'Sequencer';
  picker.setAttribute('aria-label', 'Sequencer');
  const current = partAt(ctx.model.doc, slot)?.sequencer.kind ?? 'none';
  // The Roll is offered once a part can be set to one by its region rule and device (windsor#601,
  // windsor#602); a part that already is one (an imported song) still names it.
  for (const kind of SEQUENCER_KINDS) {
    if (kind === 'roll' && current !== 'roll') continue;
    picker.add(new Option(`Seq: ${KIND_LABELS[kind]}`, kind));
  }
  picker.value = current;
  picker.onchange = (): void => {
    if (!setSequencerKindLive(ctx, slot, picker.value as SequencerKind))
      picker.value = partAt(ctx.model.doc, slot)?.sequencer.kind ?? 'none';
  };
  return picker;
}

/** `PART`, the name field and the sequencer select, for the start of the bar. */
export function partListControls(ctx: AppCtx): HTMLElement[] {
  const slot = ctx.parts.selected;
  if (!partAt(ctx.model.doc, slot)) return [];
  const name = partNameField(ctx, slot);
  name.classList.add('bar-name');
  return [el('span', 'field-label bar-label', 'Part'), name, kindPicker(ctx, slot)];
}
