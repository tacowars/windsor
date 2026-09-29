/**
 * The Arp card (#706, the issue's decision 7): Style, Rate, Voicing and
 * Retrigger pickers, the Vel / Gate / Octaves / Reg knobs, and the Seed field
 * with Reseed. No strip and no playhead — the walk is the chord's, so there
 * is nothing to draw. Every control writes the document through
 * `ctx.change`, a pattern field into the pane's selected region's pattern
 * and the seed into the part's (windsor#75); a Rate or Seed edit rebuilds the part in the engine (a seed
 * restarts its stream at once — record
 * `2026-09-26-harmony-v2-document-v3-timeline-and-regions`).
 */
import type { ArpSpec } from '@windsor/engine';
import { DEFAULT_ARP_CONFIG } from '@windsor/engine';
import { arpSeedChange, freshSeed, parseSeed } from './arpModel';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg, select } from './dom';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
import { changePattern } from './partEdits';
import { knobRow } from './seqFields';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { ARP_KNOBS, ARP_STYLE_OPTIONS, ARP_VOICING_OPTIONS } from './sequencerKnobTables';
import { specOf } from './stepStrip';

const HINT =
  'One note per step from the chord under the playhead: voiced at Reg, ' +
  'stacked up Octaves, walked by Style. Retrigger restarts the walk on a chord change.';

/** The part on `slot`, and the region whose pattern the card edits (windsor#75). */
interface ArpTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
}

const spec = ({ ctx, slot, region }: ArpTarget): ArpSpec =>
  specOf(ctx, slot, 'arp', region) ?? { kind: 'arp', ...DEFAULT_ARP_CONFIG };

const write = (target: ArpTarget, fields: Record<string, unknown>): boolean =>
  changePattern(target.ctx, target.slot, target.region, fields);

function pickers(target: ArpTarget): HTMLElement {
  const { ctx } = target;
  const row = el('div', 'capture-row');
  const current = spec(target);
  row.appendChild(
    select('Style', ARP_STYLE_OPTIONS, current.style, (style) => write(target, { style })),
  );
  row.appendChild(
    select('Rate', DIVISOR_OPTIONS, String(current.divisor), (v) => {
      if (write(target, { divisor: Number(v) })) ctx.render();
    }),
  );
  row.appendChild(
    select('Voicing', ARP_VOICING_OPTIONS, current.voicing, (voicing) =>
      write(target, { voicing }),
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
      () => (spec(target).retrigger ? 'on' : 'off'),
      (v) => void write(target, { retrigger: v === 'on' }),
      PITCH_COLOR,
    ),
  );
  row.appendChild(retrigger);
  return row;
}

function seedRow(target: ArpTarget): HTMLElement {
  const { ctx, slot } = target;
  const row = el('div', 'capture-row');
  const wrap = el('div');
  wrap.appendChild(el('span', 'field-label', 'Seed'));
  const field = document.createElement('input');
  field.className = 'field';
  field.name = 'arp-seed';
  field.inputMode = 'numeric';
  field.setAttribute('aria-label', 'Seed');
  field.value = String(spec(target).seed);
  field.onchange = (): void => {
    const seed = parseSeed(field.value);
    if (seed === null || !ctx.change(arpSeedChange(slot, seed)).ok) {
      field.value = String(spec(target).seed);
    }
  };
  wrap.appendChild(field);
  row.appendChild(wrap);
  const reseed = el('button', 'btn', 'Reseed') as HTMLButtonElement;
  reseed.type = 'button';
  reseed.style.borderColor = PITCH_COLOR;
  reseed.title = 'A new seed: the part restarts its random stream now';
  reseed.onclick = (): void => {
    const seed = freshSeed(spec(target).seed, Math.random);
    if (ctx.change(arpSeedChange(slot, seed)).ok) field.value = String(seed);
  };
  row.appendChild(reseed);
  return row;
}

export function arpCard(ctx: AppCtx, slot: number, region?: number): HTMLElement {
  const target: ArpTarget = { ctx, slot, region };
  const body = el('div');
  body.appendChild(pickers(target));
  const knobs = knobRow(ctx, slot, ARP_KNOBS, PITCH_COLOR, region);
  knobs.appendChild(
    makeKnob({
      ...octaveKnob('arp'),
      label: 'Reg',
      color: PITCH_COLOR,
      get: () => spec(target).register.octave,
      // The Harmony tab's Octave knob writes the same field: it re-reads it when shown.
      set: (octave) => {
        if (write(target, { register: { octave } })) ctx.invalidate();
      },
    }),
  );
  body.appendChild(knobs);
  body.appendChild(seedRow(target));
  body.appendChild(el('p', 'hint', HINT));
  return body;
}
