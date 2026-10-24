/**
 * Step variation's controls on the Grid and Arp devices (windsor#936; record
 * `2026-10-24-step-variation-controls`, the approved mockup
 * `docs/design/step-variation-controls-mockup.html`): the Rests sound,
 * Octave and Per effect (windsor#945, `chance-per-effect-mockup.html`) glyph
 * buttons, and the tooltip Vary and Chance carry after the
 * knob's own. Vary and Chance themselves are table knobs
 * (`sequencerKnobTables.ts`), so they lock under their lanes as Gate does.
 *
 * A button is drawn as the app draws a toggled icon button (decision 2):
 * `.seq-icon` with `aria-pressed`, the part's accent on the inset when on,
 * at the Play section's 22 px with its border always drawn, as Reseed. A
 * press writes the field into the selected region's pattern
 * (`changePattern`, windsor#75), as the knobs do.
 */
import type { AppCtx } from './context';
import { changePattern } from './partEdits';
import { driverOf } from './seqFields';
import { railIcon, railSvg } from './sequencerRail';
import {
  STEP_VARIATION_GLYPHS,
  STEP_VARIATION_NAMES,
  STEP_VARIATION_TITLES,
  VARIATION_SWITCHES,
  type VariationAmount,
  type VariationSwitch,
} from './stepVariationTables';

/** The pattern a device's controls edit: region `region` of the part on `slot`. */
export interface VariationTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
}

/** Whether `field` is on in the pattern the target names; off when the pattern lacks it. */
const isOn = ({ ctx, slot, region }: VariationTarget, field: VariationSwitch): boolean => {
  const spec = driverOf(ctx.model.doc, slot, region);
  return spec !== undefined && field in spec && Reflect.get(spec, field) === true;
};

/** One glyph button: its tooltip, its name, its state, and the write a press makes. */
export function variationToggle(target: VariationTarget, field: VariationSwitch): HTMLElement {
  const button = railIcon(STEP_VARIATION_TITLES[field], 'seq-icon variation-toggle');
  button.setAttribute('aria-label', STEP_VARIATION_NAMES[field]);
  button.appendChild(railSvg(STEP_VARIATION_GLYPHS[field], 'seq-icon-svg seq-line-icon'));
  const paint = (): void => button.setAttribute('aria-pressed', String(isOn(target, field)));
  button.onclick = (): void => {
    const { ctx, slot, region } = target;
    if (changePattern(ctx, slot, region, { [field]: !isOn(target, field) })) paint();
  };
  paint();
  return button;
}

/** Rests sound, Octave, then Per effect. */
export const variationToggles = (target: VariationTarget): HTMLElement[] =>
  VARIATION_SWITCHES.map((field) => variationToggle(target, field));

/** Add Vary's or Chance's sentence to its knob's tooltip, after the knob's name and gestures. */
export function titleVariationKnob(knob: HTMLElement, field: VariationAmount): HTMLElement {
  knob.title = `${knob.title}. ${STEP_VARIATION_TITLES[field]}`;
  return knob;
}

/** Whether a table knob's field is a step variation amount, whose knob takes its sentence. */
export const isVariationAmount = (field: string): field is VariationAmount =>
  field === 'randomness' || field === 'probability';
