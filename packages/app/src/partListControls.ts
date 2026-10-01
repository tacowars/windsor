/**
 * The Parts tab's part list controls (#598): add a part, remove the selected
 * one, rename it, and choose its sequencer. Since #629 every one of them is a
 * live edit through `partEdits.ts` — a whole part or `null` at a slot, a
 * sequencer spec at the kind's defaults — so the transport and the other
 * parts play on; a rename is a live label change. Everything addresses the
 * part by slot — the name is only what the buttons show.
 */
import type { SequencerKind } from '@windsor/engine';
import { MUSIC_PARTS_MAX, SEQUENCER_KINDS, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { el, seg } from './dom';
import { KIND_LABELS } from './sequencerConstants';
import { openConfirm } from './metadataModal';
import { addPartLive, removePartLive, setSequencerKindLive } from './partEdits';
import { partNameField } from './partNameField';

function button(label: string, title: string, enabled: boolean): HTMLButtonElement {
  const node = el('button', 'btn', label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.disabled = !enabled;
  return node;
}

/** Add, and remove-with-confirm: the part count between 1 and `MUSIC_PARTS_MAX`. */
function addRemoveRow(ctx: AppCtx): HTMLElement {
  const row = el('div', 'bar-row');
  row.style.marginTop = '8px';
  const { parts } = ctx.model.doc;
  const add = button(
    'Add part',
    `Add a part (up to ${MUSIC_PARTS_MAX})`,
    parts.length < MUSIC_PARTS_MAX,
  );
  add.onclick = (): void => {
    addPartLive(ctx);
  };
  const remove = button('Remove part', 'Remove the selected part', parts.length > 1);
  remove.onclick = (): void => {
    const slot = ctx.parts.selected;
    const part = partAt(ctx.model.doc, slot);
    if (!part) return;
    void openConfirm({
      title: 'Remove part',
      body: `Remove "${part.name}"? Its patch stays in the song while another part plays it.`,
      ok: 'Remove',
      opener: remove,
    }).then((ok) => {
      if (ok) removePartLive(ctx, slot);
    });
  };
  row.append(add, remove);
  return row;
}

/** None / Euclidean / Arp / Step for the selected part; a change rebuilds that part alone at the kind's defaults. */
function kindPicker(ctx: AppCtx, slot: number): HTMLElement {
  const box = el('div');
  box.style.marginTop = '8px';
  box.appendChild(el('span', 'field-label', 'Sequencer'));
  box.appendChild(
    seg(
      SEQUENCER_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
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
  box.appendChild(addRemoveRow(ctx));
  const slot = ctx.parts.selected;
  if (!partAt(ctx.model.doc, slot)) return box;
  const nameRow = el('div', 'bar-row');
  nameRow.style.marginTop = '8px';
  nameRow.appendChild(partNameField(ctx, slot));
  box.appendChild(nameRow);
  box.appendChild(kindPicker(ctx, slot));
  return box;
}
