/**
 * Mixer tab (#70, record §2; #435): strips (level, pan, sends) and the
 * returns. Strip changes go through the document (`mix` overlay) and the
 * live system; the returns — space, level, the delay line — go through the
 * document's `returns` section the same way (`returnsPanel.ts`).
 */
import type {
  ChannelStrip,
  MusicPartId,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  DEFAULT_STRIP,
  MIX,
  RETURN_NAMES,
  stripFor,
} from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { SLOT_IDS } from './context';
import { el, fmt2, fmtSigned, section } from './dom';
import { makeKnob } from './knob';
import { renderReturnsSection } from './returnsPanel';

const STRIP_COLOR = '#5FA8A0';
const RETURN_COLOR = '#9C7BD0';

function stripValue(ctx: AppCtx, name: string): ChannelStrip {
  return ctx.model.doc.mix?.[name] ?? stripFor(MIX, name) ?? DEFAULT_STRIP;
}

function stripRow(ctx: AppCtx, id: MusicPartId, name: string): HTMLElement {
  const row = el('div', 'strip-row');
  row.appendChild(el('div', 'strip-name', `${name} <small>(${id})</small>`));
  const knobs = el('div', 'knob-row');
  knobs.appendChild(
    makeKnob({
      label: 'Level',
      min: 0,
      max: 2,
      def: 1,
      color: STRIP_COLOR,
      fmt: fmt2,
      get: () => stripValue(ctx, name).level,
      set: (v) => void ctx.change({ mix: { [name]: { level: v } } }),
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
      get: () => stripValue(ctx, name).pan,
      set: (v) => void ctx.change({ mix: { [name]: { pan: v } } }),
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
        get: () => stripValue(ctx, name).sends[ret] ?? 0,
        set: (v) => void ctx.change({ mix: { [name]: { sends: { [ret]: v } } } }),
      }),
    );
  }
  row.appendChild(knobs);
  return row;
}

export function renderMixerTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  const strips = section('Strips', 'Levels, pans and sends land in the document (mix overlay).');
  for (const id of SLOT_IDS) {
    const slot = ctx.model.doc[id];
    if (slot) strips.body.appendChild(stripRow(ctx, id, slot.part));
  }
  body.appendChild(strips.root);
  body.appendChild(renderReturnsSection(ctx));
}
