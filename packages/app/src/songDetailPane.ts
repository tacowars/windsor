/**
 * The Song view's detail pane (#709 decision 2): a fixed pane under the
 * lanes with a rule, a header — "Lead — Grid", "Harmony — bar 3" — and a
 * close ×. A selected part shows its existing card from `SEQUENCER_CARDS`
 * (its own strip, knobs, Randomize, Reseed and cell playhead, untouched) with
 * a row for the selected region — Split, Delete — and, for the kinds whose
 * card has no register knob (`PANE_OCTAVE_KINDS`), the Octave knob. A
 * selected chord shows `harmonyCard.ts`. One selection at a time.
 */
import type { MusicPart } from '@windsor/engine';
import { TICKS_PER_BAR, partAt } from '@windsor/engine';
import { PITCH_COLOR } from './consoleColors';
import { partChange } from './context';
import { el } from './dom';
import { harmonyCard } from './harmonyCard';
import { eventBar } from './harmonyLaneModel';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
import { deleteRegion, snapTick, splitRegion } from './regionModel';
import { SEQUENCER_CARDS } from './sequencerCards';
import { KIND_LABELS } from './sequencerConstants';
import type { SongView } from './songTab';
import { PANE_OCTAVE_KINDS, REGION_SUMMARY, forKind } from './songViewTables';

/** The pane's header: the title, a small note, and the close ×. */
function head(view: SongView, title: string, note: string): HTMLElement {
  const row = el('div', 'card-head');
  const label = el('span', '', title);
  label.appendChild(el('small', '', note));
  row.appendChild(label);
  const close = el('button', 'btn nudge', '×') as HTMLButtonElement;
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.onclick = (): void => view.select(null);
  row.appendChild(close);
  return row;
}

/** The Octave knob for a card without one: the part's absolute register (epic #703 decision 11). */
function paneOctaveKnob(
  view: SongView,
  slot: number,
  kind: MusicPart['sequencer']['kind'],
): HTMLElement {
  const { ctx } = view;
  const octave = (): number => {
    const sequencer = partAt(ctx.model.doc, slot)?.sequencer;
    return sequencer && 'register' in sequencer ? sequencer.register.octave : 0;
  };
  return makeKnob({
    ...octaveKnob(kind),
    color: PITCH_COLOR,
    get: octave,
    set: (v) => {
      if (ctx.change(partChange(slot, { sequencer: { register: { octave: v } } })).ok) {
        ctx.invalidate();
      }
    },
  });
}

/** Split and Delete for the selected region, and the Octave knob where the card lacks one. */
function partRow(view: SongView, part: MusicPart, region: number | null): HTMLElement {
  const row = el('div', 'bar-row pane-row');
  if (PANE_OCTAVE_KINDS.includes(part.sequencer.kind)) {
    row.appendChild(paneOctaveKnob(view, part.slot, part.sequencer.kind));
  }
  const write = (regions: readonly MusicPart['regions'][number][], select: number | null): void => {
    if (view.commit({ parts: { [part.slot]: { regions: [...regions] } } })) {
      view.select({ kind: 'part', slot: part.slot, region: select });
    }
  };
  const target = region === null ? null : part.regions[region];
  const split = el('button', 'btn', 'Split') as HTMLButtonElement;
  split.type = 'button';
  split.title =
    'cut the selected region in two at its middle bar (alt-click a region to cut it under the pointer)';
  split.disabled = !target || target.duration < 2 * TICKS_PER_BAR;
  split.onclick = (): void => {
    if (region === null || !target) return;
    const at = snapTick(target.start + target.duration / 2, TICKS_PER_BAR);
    write(splitRegion(part.regions, region, at), region + 1);
  };
  row.appendChild(split);
  const remove = el('button', 'btn', 'Delete region') as HTMLButtonElement;
  remove.type = 'button';
  remove.title = 'remove the selected region, leaving a rest';
  remove.disabled = !target;
  remove.onclick = (): void => {
    if (region !== null) write(deleteRegion(part.regions, region), null);
  };
  row.appendChild(remove);
  const note = el('span', 'hint pane-note');
  note.textContent = target
    ? `region ${(region ?? 0) + 1} of ${part.regions.length} selected`
    : 'click a region to split or delete it';
  row.appendChild(note);
  return row;
}

function paintPart(pane: HTMLElement, view: SongView, slot: number, region: number | null): void {
  const part = partAt(view.ctx.model.doc, slot);
  if (!part) return;
  const { kind } = part.sequencer;
  const count = part.regions.length;
  pane.appendChild(
    head(
      view,
      `${part.name} — ${KIND_LABELS[kind]}`,
      `${forKind(REGION_SUMMARY, part.sequencer)} · ${count} region${count === 1 ? '' : 's'}`,
    ),
  );
  pane.appendChild(partRow(view, part, region));
  pane.appendChild(SEQUENCER_CARDS[kind](view.ctx, slot));
}

function paintEvent(pane: HTMLElement, view: SongView, index: number): void {
  const event = view.ctx.model.doc.harmony.events[index];
  if (!event) return;
  pane.appendChild(head(view, `Harmony — bar ${eventBar(event)}`, `chord ${index + 1}`));
  pane.appendChild(harmonyCard(view, index));
}

/** Redraw the pane for the view's selection. */
export function paintDetailPane(pane: HTMLElement, view: SongView): void {
  pane.innerHTML = '';
  const { selection } = view.state;
  pane.classList.toggle('empty', selection === null);
  if (selection === null) {
    pane.appendChild(
      el(
        'p',
        'hint',
        'Select a region to edit its part, or a chord to edit the harmony. ' +
          'Click an empty stretch of a lane to add a region; + after the last chord appends one.',
      ),
    );
    return;
  }
  if (selection.kind === 'part') paintPart(pane, view, selection.slot, selection.region);
  else paintEvent(pane, view, selection.index);
}
