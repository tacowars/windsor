/**
 * Mixer tab (#70, record §2; #435): the returns and the master. Each part's
 * strip lives on the Song tab's mixer (windsor#152); the returns — space,
 * level, the delay line — go through the document's `returns` section
 * (`returnsPanel.ts`).
 */
import type { AppCtx } from './context';
import { renderReturnsSection } from './returnsPanel';
import { renderMasterStrip } from './masterStrip';

export function renderMixerTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  body.appendChild(renderReturnsSection(ctx));
  body.appendChild(renderMasterStrip(ctx));
}
