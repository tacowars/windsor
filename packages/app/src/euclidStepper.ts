/**
 * The Euclid card's value boxes (windsor#356, the mockup's `.kn` holding a
 * `.stepper`): a small label over the value, with − and + either side of
 * it. A press writes through the box's model (`euclidStepperModel.ts`),
 * then every box and knob a Steps change can move re-reads; a button at its
 * limit is disabled.
 */
import { el } from './dom';
import type { EuclidCard } from './euclidCardState';
import type { StepDelta, StepperModel } from './euclidStepperModel';
import type { KnobElement } from './knob';

/** One box: its label, its model, and what its − and + say to a screen reader. */
export interface StepperOpts {
  readonly label: string;
  readonly model: StepperModel;
  readonly less: string;
  readonly more: string;
}

function stepButton(text: string, aria: string): HTMLButtonElement {
  const button = el('button', 'euclid-step', text) as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-label', aria);
  return button;
}

/** A value box for the card's part and region; it joins `card.dependents`. */
export function stepperBox(card: EuclidCard, opts: StepperOpts): KnobElement {
  const { model } = opts;
  const box = el('div', 'euclid-kn') as KnobElement;
  const value = el('span', 'euclid-kn-value euclid-stepper');
  const down = stepButton('−', opts.less);
  const up = stepButton('+', opts.more);
  const out = document.createElement('output');
  value.append(down, out, up);
  box.append(el('span', 'euclid-kn-label', opts.label), value);
  box.refresh = (): void => {
    const spec = card.spec();
    out.textContent = spec ? model.text(spec) : '';
    down.disabled = !spec || model.step(spec, -1) === null;
    up.disabled = !spec || model.step(spec, 1) === null;
  };
  const press = (delta: StepDelta): void => {
    const spec = card.spec();
    const fields = spec && model.step(spec, delta);
    if (fields && card.write(fields)) card.dependents.forEach((k) => k.refresh());
  };
  down.onclick = (): void => press(-1);
  up.onclick = (): void => press(1);
  box.refresh();
  card.dependents.push(box);
  return box;
}
