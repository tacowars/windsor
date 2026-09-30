/**
 * The Parametric EQ card's controls around its curve (windsor#199 decision
 * 2; the mockup's `.chips`, `.range` and `.band`): the band row, whose chip
 * selects a band and whose square turns it on or off; the ±12 / ±24 view
 * toggle in the plot's corner; and the selected band's panel, "Band N ·
 * Type" over Type, Slope (a cut's only) and Listen on drag, then Freq, Gain
 * (a bell's or shelf's only) and Q (not a 6 dB cut's), a rule, and Scale and
 * Output. Built from `insertLayout.ts`'s columns and the rack's knobs.
 */
import type { EqBand, EqBandType, EqSlope, EqSpec } from '@windsor/engine';
import { EQ_BAND_TYPES, EQ_SLOPES } from '@windsor/engine';
import { STRIP_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { el, html } from './dom';
import type { EqPlot } from './eqCurveModel';
import { hasQ, roleOf, withBand } from './eqCurveModel';
import type { EqBandKnobField, EqView } from './eqTables';
import {
  EQ_GLOBAL_KNOBS,
  EQ_GLYPH_BOX,
  EQ_KNOB_OFF_TEXT,
  EQ_RANGES,
  EQ_TYPE_GLYPHS,
  EQ_TYPE_LABELS,
  eqBandKnob,
  eqSlopeLabel,
} from './eqTables';
import { withGesture } from './gestureHooks';
import { insertKnob } from './insertKnobs';
import { insertColumn, insertRule, insertSelect, insertSwitch, wideColumn } from './insertLayout';
import type { InsertTarget } from './insertTarget';
import { makeKnob } from './knob';

/** One EQ card's reads and writes, shared by its band row, curve and panel. */
export interface EqCardModel {
  spec(): EqSpec;
  view(): EqView;
  setView(patch: Partial<EqView>): void;
  /** Send `spec` as the insert's next settings; false when the engine refused it. */
  commit(spec: EqSpec): boolean;
  sampleRate(): number;
  plot(): EqPlot;
}

/** The band at `field` of the selected band set to `value`, committed. */
export function commitBandField<K extends keyof EqBand>(
  model: EqCardModel,
  field: K,
  value: EqBand[K],
): boolean {
  const spec = model.spec();
  const at = model.view().band;
  const band = spec.bands[at];
  return band ? model.commit(withBand(spec, at, { ...band, [field]: value })) : false;
}

/** What a control asks its card to redraw: the curve, the curve and the band row, or everything. */
export type EqRepaint = (what: 'curve' | 'band' | 'all') => void;

function button(className: string, label: string): HTMLButtonElement {
  const b = el('button', className) as HTMLButtonElement;
  b.type = 'button';
  b.setAttribute('aria-label', label);
  return b;
}

const glyph = (type: EqBandType): HTMLElement =>
  html(
    'span',
    'eq-glyph',
    `<svg width="${EQ_GLYPH_BOX.width}" height="${EQ_GLYPH_BOX.height}" ` +
      `viewBox="0 0 ${EQ_GLYPH_BOX.width} ${EQ_GLYPH_BOX.height}" aria-hidden="true">` +
      `<path d="${EQ_TYPE_GLYPHS[type]}"/></svg>`,
  );

/** The eight chips: on square, type glyph, number. */
export function eqBandRow(model: EqCardModel, repaint: EqRepaint): HTMLElement[] {
  const spec = model.spec();
  const selected = model.view().band;
  return spec.bands.map((band, i) => {
    const chip = el('div', 'eq-chip');
    chip.classList.toggle('on', band.on);
    chip.classList.toggle('selected', i === selected);
    const power = button('eq-chip-on', `Band ${i + 1} on`);
    power.title = 'On or off';
    power.setAttribute('aria-pressed', String(band.on));
    power.onclick = (): void => {
      const now = model.spec();
      const held = now.bands[i]!;
      withGesture(`EQ band ${i + 1}`, () =>
        model.commit(withBand(now, i, { ...held, on: !held.on })),
      );
      model.setView({ band: i });
      repaint('all');
    };
    const pick = button(
      'eq-chip-pick',
      `Band ${i + 1}, ${EQ_TYPE_LABELS[band.type]}, ${band.on ? 'on' : 'off'}`,
    );
    pick.setAttribute('role', 'tab');
    pick.setAttribute('aria-selected', String(i === selected));
    pick.append(glyph(band.type), el('span', 'eq-chip-num', String(i + 1)));
    pick.onclick = (): void => {
      model.setView({ band: i });
      repaint('all');
    };
    chip.append(power, pick);
    return chip;
  });
}

/** The plot's ±12 / ±24 toggle. */
export function eqRangeToggle(model: EqCardModel, changed: () => void): HTMLElement {
  const row = el('div', 'eq-range');
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Curve range');
  const buttons = EQ_RANGES.map((range) => {
    const b = button('', `±${range} dB`);
    b.textContent = `±${range}`;
    b.onclick = (): void => {
      model.setView({ range });
      sync();
      changed();
    };
    return b;
  });
  const sync = (): void =>
    buttons.forEach((b, i) =>
      b.setAttribute('aria-pressed', String(EQ_RANGES[i] === model.view().range)),
    );
  sync();
  row.append(...buttons);
  return row;
}

function bandKnob(
  model: EqCardModel,
  field: EqBandKnobField,
  o: { readonly off: boolean; readonly repaint: EqRepaint },
): HTMLElement {
  const at = model.view().band;
  const spec = eqBandKnob(field, at);
  const knob = makeKnob({
    ...spec,
    // A band plays no higher than the plot reaches at the running sample rate.
    ...(field === 'freq' ? { max: model.plot().maxFreq } : {}),
    ...(o.off ? { fmt: () => EQ_KNOB_OFF_TEXT } : {}),
    color: STRIP_COLOR,
    dial: 'rack',
    get: () => model.spec().bands[at]?.[field] ?? spec.def,
    set: (v) => void commitBandField(model, field, v),
    onChange: () => o.repaint('curve'),
  });
  if (o.off) {
    knob.classList.add('eq-knob-off');
    knob.tabIndex = -1;
    knob.setAttribute('aria-disabled', 'true');
  }
  return knob;
}

function pickers(model: EqCardModel, repaint: EqRepaint): HTMLElement {
  const at = model.view().band;
  const band = model.spec().bands[at]!;
  const heading = el('div', 'eq-heading');
  heading.append('Band ', el('b', '', String(at + 1)), ` · ${EQ_TYPE_LABELS[band.type]}`);
  const type = insertSelect({
    label: 'Type',
    options: EQ_BAND_TYPES.map((t) => [t, EQ_TYPE_LABELS[t]] as const),
    value: band.type,
    change: (value) => {
      withGesture(`EQ band ${at + 1}`, () => commitBandField(model, 'type', value as EqBandType));
      repaint('all');
    },
  });
  const slope = insertSelect({
    label: 'Slope',
    options: EQ_SLOPES.map((s) => [String(s), eqSlopeLabel(s)] as const),
    value: String(band.slope),
    change: (value) => {
      withGesture(`EQ band ${at + 1}`, () =>
        commitBandField(model, 'slope', Number(value) as EqSlope),
      );
      repaint('all');
    },
  });
  slope.querySelector('select')!.disabled = roleOf(band) !== 'cut';
  const listen = insertSwitch('Listen on drag', model.view().listen, (listen) =>
    model.setView({ listen }),
  );
  const column = wideColumn(heading, type, slope, listen);
  column.classList.add('eq-controls');
  return column;
}

/** The selected band's panel, a rule, and Scale and Output. */
export function eqPanel(
  ctx: AppCtx,
  slot: InsertTarget,
  index: number,
  model: EqCardModel,
  repaint: EqRepaint,
): HTMLElement[] {
  const band = model.spec().bands[model.view().band]!;
  const knob = (field: EqBandKnobField, off: boolean): HTMLElement =>
    bandKnob(model, field, { off, repaint });
  const [scale, output] = EQ_GLOBAL_KNOBS.map((entry) =>
    insertKnob(ctx, slot, index, entry, () => repaint('curve')),
  );
  return [
    pickers(model, repaint),
    insertColumn(knob('freq', false), knob('q', !hasQ(band))),
    insertColumn(knob('gain', roleOf(band) !== 'gain'), el('div', 'eq-knob-spacer')),
    insertRule(),
    insertColumn(scale!, output!),
  ];
}
