/**
 * Mixer tab (#70, record §2; #435): strips (level, pan, low cut, sends, inserts) and the
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
import { RETURN_COLOR, STRIP_COLOR } from './consoleColors';
import { el, section } from './dom';
import { makeKnob } from './knob';
import {
  SEND_DEFAULT,
  STRIP_LEVEL_KNOB,
  STRIP_LOW_CUT_KNOB,
  STRIP_PAN_KNOB,
  sendKnob,
} from './mixerTables';
import { partNameField } from './partNameField';
import { renderReturnsSection } from './returnsPanel';
import { stripInserts } from './stripInserts';

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
      ...STRIP_LEVEL_KNOB,
      color: STRIP_COLOR,
      get: () => stripValue(ctx, slot).level,
      set: (v) => void ctx.change(partChange(slot, { strip: { level: v } })),
    }),
  );
  knobs.appendChild(
    makeKnob({
      ...STRIP_PAN_KNOB,
      color: STRIP_COLOR,
      get: () => stripValue(ctx, slot).pan,
      set: (v) => void ctx.change(partChange(slot, { strip: { pan: v } })),
    }),
  );
  knobs.appendChild(
    makeKnob({
      ...STRIP_LOW_CUT_KNOB,
      color: STRIP_COLOR,
      get: () => stripValue(ctx, slot).lowCut,
      set: (v) => void ctx.change(partChange(slot, { strip: { lowCut: v } })),
    }),
  );
  for (const ret of RETURN_NAMES) {
    knobs.appendChild(
      makeKnob({
        ...sendKnob(ret),
        color: RETURN_COLOR,
        get: () => stripValue(ctx, slot).sends[ret] ?? SEND_DEFAULT,
        set: (v) => void ctx.change(partChange(slot, { strip: { sends: { [ret]: v } } })),
      }),
    );
  }
  row.appendChild(knobs);
  row.appendChild(stripInserts(ctx, slot));
  return row;
}

export function renderMixerTab(body: HTMLElement, ctx: AppCtx): void {
  body.innerHTML = '';
  const strips = section(
    'Strips',
    "Levels, pans, low cuts, sends and inserts land in each part's own strip. " +
      'A strip feeds its inserts after its Level, so Level changes how hard it drives them. ' +
      'Inserts run left to right; the arrows move one along the chain.',
  );
  for (const part of ctx.model.doc.parts) {
    strips.body.appendChild(stripRow(ctx, part.slot));
  }
  body.appendChild(strips.root);
  body.appendChild(renderReturnsSection(ctx));
}
