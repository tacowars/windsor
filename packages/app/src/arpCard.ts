/**
 * The Arp device (#706; a rack device since windsor#370, record
 * `2026-10-01-sequencer-rack-devices` decisions 1–6 and 8, look
 * `docs/research/2026-09-30-sequencer-rack/arp.html`): the body the Song
 * pane's frame (`sequencerDevice.ts`) puts beside the shared rail, at the
 * device's one height. Two sections: Play, the controls in columns — Style,
 * Rate and Voicing; Retrigger, Seed with Reseed as an icon beside it, and
 * Randomize; then, behind a rule, Octave, Octaves and Rotate, Vel, Acc vel
 * and Acc mod, Gate and Skip — and Cycle, the strip (`arpGrid.ts`), as wide
 * as the arp's cycle. The sizes are the `--arp-*` entries of
 * `SEQUENCER_DEVICE_PX`; the hint paragraph went with windsor#370, and the
 * cells keep their tooltips.
 *
 * Every control writes the document through `ctx.change`, a pattern field
 * into the pane's selected region's pattern and the seed into the part's
 * (windsor#75); a Rate or Seed edit rebuilds the part in the engine (a seed
 * restarts its stream at once — record
 * `2026-09-26-harmony-v2-document-v3-timeline-and-regions`).
 */
import type { ArpSpec } from '@windsor/engine';
import { DEFAULT_ARP_CONFIG } from '@windsor/engine';
import { arpGrid } from './arpGrid';
import { ARP_KNOB_COLUMNS } from './arpGridConstants';
import { arpSeedChange, freshSeed, parseSeed } from './arpModel';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, seg, select } from './dom';
import { octaveKnob } from './harmonyTables';
import { makeKnob } from './knob';
import { changePattern } from './partEdits';
import { tableKnob } from './seqFields';
import type { DeviceBody } from './sequencerDevice';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import {
  ARP_GRID_KNOBS,
  ARP_KNOBS,
  ARP_STYLE_OPTIONS,
  ARP_VOICING_OPTIONS,
} from './sequencerKnobTables';
import { railIcon, railSvg } from './sequencerRail';
import { specOf } from './stepStrip';

/** Reseed's icon: a circling arrow. */
const ICON_RESEED = '<path d="M10 6a4 4 0 1 1-1.2-2.85M10 1.5v2.5H7.5"/>';

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

function column(className: string, nodes: readonly HTMLElement[]): HTMLElement {
  const col = el('div', `seq-col ${className}`);
  col.append(...nodes);
  return col;
}

/** Style, Rate and Voicing. */
function pickers(target: ArpTarget): HTMLElement[] {
  const { ctx } = target;
  const current = spec(target);
  return [
    select('Style', ARP_STYLE_OPTIONS, current.style, (style) => write(target, { style })),
    select('Rate', DIVISOR_OPTIONS, String(current.divisor), (v) => {
      if (write(target, { divisor: Number(v) })) ctx.render();
    }),
    select('Voicing', ARP_VOICING_OPTIONS, current.voicing, (voicing) =>
      write(target, { voicing }),
    ),
  ];
}

function retrigger(target: ArpTarget): HTMLElement {
  const wrap = el('div');
  wrap.appendChild(el('span', 'field-label', 'Retrigger'));
  wrap.appendChild(
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
  return wrap;
}

/** The Seed field, and Reseed as an icon beside it (decision 8): today's title and write. */
function seedField(target: ArpTarget): HTMLElement {
  const { ctx, slot } = target;
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
  const reseed = railIcon(
    'A new seed: the part restarts its random stream now',
    'seq-icon arp-reseed',
  );
  reseed.setAttribute('aria-label', 'Reseed');
  reseed.appendChild(railSvg(ICON_RESEED, 'seq-icon-svg seq-line-icon'));
  reseed.onclick = (): void => {
    const seed = freshSeed(spec(target).seed, Math.random);
    if (ctx.change(arpSeedChange(slot, seed)).ok) field.value = String(seed);
  };
  const row = el('div', 'arp-seed');
  row.append(field, reseed);
  const wrap = el('div');
  wrap.append(el('span', 'field-label', 'Seed'), row);
  return wrap;
}

/** The pattern's register octave (today's Reg): where the arp's chord is voiced. */
function octave(target: ArpTarget): HTMLElement {
  const { ctx } = target;
  return makeKnob({
    ...octaveKnob('arp'),
    label: 'Octave',
    color: PITCH_COLOR,
    get: () => spec(target).register.octave,
    // The Harmony tab's Octave knob writes the same field: it re-reads it when shown.
    set: (v) => {
      if (write(target, { register: { octave: v } })) ctx.invalidate();
    },
  });
}

/** The knob strip: Octave, Octaves and Rotate, then the table knobs in their columns. */
function knobStrip(target: ArpTarget, rotate: HTMLElement): HTMLElement {
  const { ctx, slot, region } = target;
  const entries = [...ARP_KNOBS, ...ARP_GRID_KNOBS];
  const knob = (field: string): HTMLElement[] => {
    const entry = entries.find((e) => e.f === field);
    return entry ? [tableKnob(ctx, slot, entry, PITCH_COLOR, region)] : [];
  };
  const strip = el('div', 'arp-knobs');
  strip.append(
    column('k3', [octave(target), ...knob('octaves'), rotate]),
    ...ARP_KNOB_COLUMNS.map((fields) => column('k3', fields.flatMap(knob))),
  );
  return strip;
}

/** The Play section: the pickers, the seed column, then the knob strip behind its rule. */
function controls(target: ArpTarget, grid: ReturnType<typeof arpGrid>): HTMLElement {
  const body = el('div', 'seq-sec-body');
  body.append(
    column('wide arp-fields', pickers(target)),
    column('wide arp-fields', [retrigger(target), seedField(target), grid.randomize]),
    knobStrip(target, grid.rotate),
  );
  const section = el('div', 'seq-section play');
  section.append(el('div', 'seq-sec-label', 'Play'), body);
  return section;
}

/** The device body for an `arp` part's region `region`: the controls and the cycle's strip. */
export function arpCard(ctx: AppCtx, slot: number, region?: number): DeviceBody {
  const target: ArpTarget = { ctx, slot, region };
  const grid = arpGrid(ctx, slot, region);
  const body = el('div', 'seq-device-body arp-device');
  body.append(controls(target, grid), grid.section);
  return { body, fit: 'fixed' };
}
