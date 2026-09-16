/**
 * The Parts tab's part list controls (#598): add a part, remove the selected
 * one, rename it, and choose its sequencer. Structural edits go through
 * `ctx.restructure` (renormalise, rebuild, re-render) over the pure edits in
 * `songParts.ts`; a rename is a live label change. Everything addresses the
 * part by slot — the name is only what the buttons show.
 */
import type { SequencerKind } from '../../../packages/client/src/audio/index-for-editor';
import {
  MUSIC_PARTS_MAX,
  SEQUENCER_KINDS,
  partAt,
  removePart,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, seg } from './dom';
import { openConfirm } from './metadataModal';
import { partsState } from './patchState';
import { addPart, replaceDraft, setSequencerKind } from './songParts';

const KIND_LABELS: Record<SequencerKind, string> = {
  none: 'None',
  euclidean: 'Euclid',
  arp: 'Arp',
  step: 'Step',
};

function button(label: string, title: string, enabled: boolean): HTMLButtonElement {
  const node = el('button', 'btn', label) as HTMLButtonElement;
  node.type = 'button';
  node.title = title;
  node.disabled = !enabled;
  return node;
}

/** Add, and remove-with-confirm: the part count between 1 and 8. */
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
    const added = addPart(ctx.model.doc);
    if (!added) return;
    partsState.selected = added.slot;
    ctx.restructure((draft) => replaceDraft(draft, added.doc));
    ctx.status(`added ${partAt(ctx.model.doc, added.slot)?.name ?? 'a part'} — pick its sequencer`);
  };
  const remove = button('Remove part', 'Remove the selected part', parts.length > 1);
  remove.onclick = (): void => {
    const slot = partsState.selected;
    const part = partAt(ctx.model.doc, slot);
    if (!part) return;
    void openConfirm({
      title: 'Remove part',
      body: `Remove "${part.name}"? Its patch stays in the song while another part plays it.`,
      ok: 'Remove',
      opener: remove,
    }).then((ok) => {
      if (!ok) return;
      const index = ctx.model.doc.parts.findIndex((p) => p.slot === slot);
      const next = removePart(ctx.model.doc, slot);
      if (next === ctx.model.doc) return;
      // The nearest remaining part: the one that took this index, else the last.
      const neighbour = next.parts[Math.min(index, next.parts.length - 1)];
      partsState.selected = neighbour?.slot ?? 0;
      ctx.restructure((draft) => replaceDraft(draft, next));
      ctx.status(`removed ${part.name}`);
    });
  };
  row.append(add, remove);
  return row;
}

/** The selected part's label: committed on change (Enter or blur), never used as a key. */
function nameField(ctx: AppCtx, slot: number): HTMLElement {
  const input = document.createElement('input');
  input.className = 'field';
  input.name = 'part-name';
  input.value = partAt(ctx.model.doc, slot)?.name ?? '';
  input.setAttribute('aria-label', 'Part name');
  input.onchange = (): void => {
    const name = input.value.trim();
    if (name === '' || name === partAt(ctx.model.doc, slot)?.name) return;
    if (ctx.change(partChange(slot, { name })).ok) ctx.render();
  };
  return input;
}

/** None / Euclidean / Arp / Step for the selected part; a change rebuilds at the kind's defaults. */
function kindPicker(ctx: AppCtx, slot: number): HTMLElement {
  const box = el('div');
  box.style.marginTop = '8px';
  box.appendChild(el('span', 'field-label', 'Sequencer'));
  box.appendChild(
    seg(
      SEQUENCER_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
      () => partAt(ctx.model.doc, slot)?.sequencer.kind ?? 'none',
      (value) => {
        const next = setSequencerKind(ctx.model.doc, slot, value as SequencerKind);
        if (next === ctx.model.doc) return;
        ctx.restructure((draft) => replaceDraft(draft, next));
      },
    ),
  );
  return box;
}

export function partListControls(ctx: AppCtx): HTMLElement {
  const box = el('div');
  box.appendChild(addRemoveRow(ctx));
  const slot = partsState.selected;
  if (!partAt(ctx.model.doc, slot)) return box;
  const nameRow = el('div', 'bar-row');
  nameRow.style.marginTop = '8px';
  nameRow.appendChild(nameField(ctx, slot));
  box.appendChild(nameRow);
  box.appendChild(kindPicker(ctx, slot));
  return box;
}
