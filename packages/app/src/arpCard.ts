/**
 * The Arp card (#706, the issue's decision 7): Style, Rate, Voicing and
 * Retrigger pickers, the Vel / Gate / Octaves / Reg knobs, and the Seed field
 * with Reseed. No strip and no playhead — the walk is the chord's, so there
 * is nothing to draw. Every control writes the document through
 * `ctx.change`; a Rate or Seed edit rebuilds the part in the engine (a seed
 * restarts its stream at once — record
 * `2026-09-26-harmony-v2-document-v3-timeline-and-regions`).
 */
import type { ArpSpec } from '../../../packages/client/src/audio/index-for-editor';
import { DEFAULT_ARP_CONFIG } from '../../../packages/client/src/audio/index-for-editor';
import { arpSeedChange, freshSeed, parseSeed } from './arpModel';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, seg, select } from './dom';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
import { knobRow } from './seqFields';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { ARP_KNOBS, ARP_STYLE_OPTIONS, ARP_VOICING_OPTIONS } from './sequencerKnobTables';
import { specOf } from './stepStrip';

const HINT =
  'One note per step from the chord under the playhead: voiced at Reg, ' +
  'stacked up Octaves, walked by Style. Retrigger restarts the walk on a chord change.';

const spec = (ctx: AppCtx, slot: number): ArpSpec =>
  specOf(ctx, slot, 'arp') ?? { kind: 'arp', ...DEFAULT_ARP_CONFIG };

const write = (ctx: AppCtx, slot: number, fields: Record<string, unknown>): boolean =>
  ctx.change(partChange(slot, { sequencer: fields })).ok;

function pickers(ctx: AppCtx, slot: number): HTMLElement {
  const row = el('div', 'capture-row');
  const current = spec(ctx, slot);
  row.appendChild(
    select('Style', ARP_STYLE_OPTIONS, current.style, (style) => write(ctx, slot, { style })),
  );
  row.appendChild(
    select('Rate', DIVISOR_OPTIONS, String(current.divisor), (v) => {
      if (write(ctx, slot, { divisor: Number(v) })) ctx.render();
    }),
  );
  row.appendChild(
    select('Voicing', ARP_VOICING_OPTIONS, current.voicing, (voicing) =>
      write(ctx, slot, { voicing }),
    ),
  );
  const retrigger = el('div');
  retrigger.appendChild(el('span', 'field-label', 'Retrigger'));
  retrigger.appendChild(
    seg(
      [
        { value: 'off', label: 'off' },
        { value: 'on', label: 'on' },
      ],
      () => (spec(ctx, slot).retrigger ? 'on' : 'off'),
      (v) => void write(ctx, slot, { retrigger: v === 'on' }),
      PITCH_COLOR,
    ),
  );
  row.appendChild(retrigger);
  return row;
}

function seedRow(ctx: AppCtx, slot: number): HTMLElement {
  const row = el('div', 'capture-row');
  const wrap = el('div');
  wrap.appendChild(el('span', 'field-label', 'Seed'));
  const field = document.createElement('input');
  field.className = 'field';
  field.name = 'arp-seed';
  field.inputMode = 'numeric';
  field.setAttribute('aria-label', 'Seed');
  field.value = String(spec(ctx, slot).seed);
  field.onchange = (): void => {
    const seed = parseSeed(field.value);
    if (seed === null || !ctx.change(arpSeedChange(slot, seed)).ok) {
      field.value = String(spec(ctx, slot).seed);
    }
  };
  wrap.appendChild(field);
  row.appendChild(wrap);
  const reseed = el('button', 'btn', 'Reseed') as HTMLButtonElement;
  reseed.type = 'button';
  reseed.style.borderColor = PITCH_COLOR;
  reseed.title = 'A new seed: the part restarts its random stream now';
  reseed.onclick = (): void => {
    const seed = freshSeed(spec(ctx, slot).seed, Math.random);
    if (ctx.change(arpSeedChange(slot, seed)).ok) field.value = String(seed);
  };
  row.appendChild(reseed);
  return row;
}

export function arpCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  body.appendChild(pickers(ctx, slot));
  const knobs = knobRow(ctx, slot, ARP_KNOBS, PITCH_COLOR);
  knobs.appendChild(
    makeKnob({
      ...octaveKnob('arp'),
      label: 'Reg',
      color: PITCH_COLOR,
      get: () => spec(ctx, slot).register.octave,
      // The Harmony tab's Octave knob writes the same field: it re-reads it when shown.
      set: (octave) => {
        if (write(ctx, slot, { register: { octave } })) ctx.invalidate();
      },
    }),
  );
  body.appendChild(knobs);
  body.appendChild(seedRow(ctx, slot));
  body.appendChild(el('p', 'hint', HINT));
  return body;
}
