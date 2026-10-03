/**
 * The Parts tab's part controls (#598): rename the selected part and choose
 * its sequencer. Adding and removing a part moved to the header's part strip
 * (windsor#520, `partStrip.ts`). A kind change is a live edit through
 * `partEdits.ts` — a sequencer spec at the kind's defaults — so the
 * transport and the other parts play on; a rename is a live label change.
 * Everything addresses the part by slot.
 */
import type { SequencerKind } from '@windsor/engine';
import { SEQUENCER_KINDS, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el, seg } from './dom';
import { KIND_LABELS } from './sequencerConstants';
import { setSequencerKindLive } from './partEdits';
import { partNameField } from './partNameField';

/** None / Euclidean / Arp / Step for the selected part; a change rebuilds that part alone at the kind's defaults. */
function kindPicker(ctx: AppCtx, slot: number): HTMLElement {
  const box = el('div');
  box.style.marginTop = '8px';
  box.appendChild(el('span', 'field-label', 'Sequencer'));
  box.appendChild(
    seg(
      SEQUENCER_KINDS.map((kind) => ({
        value: kind,
        label: KIND_LABELS[kind],
      })),
      () => partAt(ctx.model.doc, slot)?.sequencer.kind ?? 'none',
      (value) => {
        setSequencerKindLive(ctx, slot, value as SequencerKind);
      },
    ),
  );
  return box;
}

export function partListControls(ctx: AppCtx): HTMLElement {
  const box = el('div');
  const slot = ctx.parts.selected;
  if (!partAt(ctx.model.doc, slot)) return box;
  const nameRow = el('div', 'bar-row');
  nameRow.appendChild(partNameField(ctx, slot));
  box.appendChild(nameRow);
  box.appendChild(kindPicker(ctx, slot));
  return box;
}
