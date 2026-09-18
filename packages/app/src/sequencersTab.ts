/**
 * Sequencers tab (#70, record §2): one card per part, drawn for the part's
 * sequencer kind (#597) through the card registry (`sequencerCards.ts`, #619
 * decision 3) — the Euclidean card with its figure strip and density
 * modulator (`euclidCard.ts`, #610; the density LFO periods live there, not in
 * Harmony: they modulate density, not pitch), the grid card (`gridCard.ts`,
 * #603), the chord card (`chordCard.ts`, #607), and the arp and step cards
 * with their divisor and capture-to-fixed (record §6). Adding, removing and
 * re-kinding parts is the part list's job (#598); the knob specs are
 * `sequencerKnobTables.ts`.
 */
import type { MusicPart } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { section } from './dom';
import { SEQUENCER_CARDS } from './sequencerCards';
import { KIND_LABELS } from './sequencerConstants';

function partCard(ctx: AppCtx, part: MusicPart): HTMLElement {
  const { kind } = part.sequencer;
  const { root, body } = section(`${part.name} · ${KIND_LABELS[kind]}`);
  body.appendChild(SEQUENCER_CARDS[kind](ctx, part.slot));
  return root;
}

export function renderSequencersTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  for (const part of ctx.model.doc.parts) body.appendChild(partCard(ctx, part));
}
