/**
 * Sequencers tab (#70, record §2): one card per part, drawn for the part's
 * sequencer kind (#597) — the Euclidean card with its figure strip and
 * density modulator (`euclidCard.ts`, #610; the density LFO periods live
 * there, not in Harmony: they modulate density, not pitch), the grid card
 * (`gridCard.ts`, #603), arp mode and skip, step divisor and gate — plus
 * capture-to-fixed (record §6). Adding, removing and re-kinding parts is the
 * part list's job (#598). The knob specs are `sequencerKnobTables.ts`.
 */
import type { MusicPart } from '../../../packages/client/src/audio/index-for-editor';
import {
  ARP_WALK_MODES,
  DEFAULT_ARPEGGIATOR_CONFIG,
} from '../../../packages/client/src/audio/index-for-editor';
import { chordCard } from './chordCard';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, section, seg } from './dom';
import { euclidCard } from './euclidCard';
import { gridCard } from './gridCard';
import { captureControls, divisorPicker, driverOf, knobRow } from './seqFields';
import { KIND_LABELS } from './sequencerConstants';
import { ARP_KNOBS, STEP_KNOBS } from './sequencerKnobTables';

function arpCard(ctx: AppCtx, slot: number): HTMLElement {
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

function stepCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  body.appendChild(knobRow(ctx, slot, STEP_KNOBS, PITCH_COLOR));
  body.appendChild(divisorPicker(ctx, slot));
  body.appendChild(captureControls(ctx, slot, PITCH_COLOR));
  return body;
}

function partCard(ctx: AppCtx, part: MusicPart): HTMLElement {
  const { kind } = part.sequencer;
  const { root, body } = section(`${part.name} · ${KIND_LABELS[kind]}`);
  if (kind === 'euclidean') body.appendChild(euclidCard(ctx, part.slot));
  else if (kind === 'arp') body.appendChild(arpCard(ctx, part.slot));
  else if (kind === 'step') body.appendChild(stepCard(ctx, part.slot));
  else if (kind === 'grid') body.appendChild(gridCard(ctx, part.slot));
  else if (kind === 'chord') body.appendChild(chordCard(ctx, part.slot));
  else body.appendChild(el('p', 'hint', 'No sequencer: this part plays only from the keyboard.'));
  return root;
}

export function renderSequencersTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  for (const part of ctx.model.doc.parts) body.appendChild(partCard(ctx, part));
}
