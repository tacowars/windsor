/**
 * Mixer tab (#70, record §2; #435): strips (level, pan, sends) and the
 * returns. Each part owns its strip (#597): a change goes through the part's
 * `strip` in the document and the live system; the returns — space, level, the delay line — go through the
 * document's `returns` section the same way (`returnsPanel.ts`).
 */
import type { ChannelStrip } from '../../../packages/client/src/audio/index-for-editor';
import {
  DEFAULT_STRIP,
  RETURN_NAMES,
  partAt,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, fmt2, fmtSigned, section } from './dom';
import { makeKnob } from './knob';
import { partNameField } from './partNameField';
import { renderReturnsSection } from './returnsPanel';

const STRIP_COLOR = '#5FA8A0';
const RETURN_COLOR = '#9C7BD0';

function stripValue(ctx: AppCtx, slot: number): ChannelStrip {
  return partAt(ctx.model.doc, slot)?.strip ?? DEFAULT_STRIP;
}

function stripRow(ctx: AppCtx, slot: number): HTMLElement {
  const row = el('div', 'strip-row');
  const label = el('div', 'strip-name');
  label.appendChild(partNameField(ctx, slot));
  label.appendChild(el('small', '', ` slot ${slot}`));
  row.appendChild(label);
  const knobs = el('div', 'knob-row');
  knobs.appendChild(
    makeKnob({
      label: 'Level',
      min: 0,
      max: 2,
      def: 1,
      color: STRIP_COLOR,
      fmt: fmt2,
      get: () => stripValue(ctx, slot).level,
      set: (v) => void ctx.change(partChange(slot, { strip: { level: v } })),
    }),
  );
  knobs.appendChild(
    makeKnob({
      label: 'Pan',
      min: -1,
      max: 1,
      def: 0,
      color: STRIP_COLOR,
      fmt: fmtSigned,
      get: () => stripValue(ctx, slot).pan,
      set: (v) => void ctx.change(partChange(slot, { strip: { pan: v } })),
    }),
  );
  for (const ret of RETURN_NAMES) {
    knobs.appendChild(
      makeKnob({
        label: `→ ${ret}`,
        min: 0,
        max: 1,
        def: 0,
        color: RETURN_COLOR,
        fmt: fmt2,
        get: () => stripValue(ctx, slot).sends[ret] ?? 0,
        set: (v) => void ctx.change(partChange(slot, { strip: { sends: { [ret]: v } } })),
      }),
    );
  }
  row.appendChild(knobs);
  return row;
}

export function renderMixerTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  const strips = section('Strips', "Levels, pans and sends land in each part's own strip.");
  for (const part of ctx.model.doc.parts) {
    strips.body.appendChild(stripRow(ctx, part.slot));
  }
  body.appendChild(strips.root);
  body.appendChild(renderReturnsSection(ctx));
}
