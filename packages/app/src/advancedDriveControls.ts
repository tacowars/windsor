/** Editor widgets share the console knob, palette, and engine ranges/defaults. */
import { el } from './dom';
import { makeKnob } from './knob';
import { STRIP_COLOR } from './consoleColors';
import { fmt2, fmtHz } from './consoleFormat';
export function driveSelect(
  label: string,
  values: readonly string[],
  value: string,
  set: (value: string) => void,
  labels = values,
): HTMLElement {
  const wrap = el('label', 'field-wrap', label),
    select = document.createElement('select');
  select.className = 'field';
  select.setAttribute('aria-label', label);
  values.forEach((v, i) => select.add(new Option(labels[i], v)));
  select.value = value;
  select.onchange = (): void => set(select.value);
  wrap.append(select);
  return wrap;
}
export function driveToggle(
  label: string,
  value: boolean,
  set: (value: boolean) => void,
): HTMLElement {
  const wrap = el('label', 'field-wrap', label),
    input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.setAttribute('aria-label', label);
  input.onchange = (): void => set(input.checked);
  wrap.append(input);
  return wrap;
}
interface NumericControl {
  label: string;
  bounds: readonly [number, number];
  def: number;
  get: () => number;
  set: (value: number) => void;
  hz?: boolean;
}
export function driveKnob(o: NumericControl): HTMLElement {
  return makeKnob({
    label: o.label,
    min: o.bounds[0],
    max: o.bounds[1],
    def: o.def,
    get: o.get,
    set: o.set,
    color: STRIP_COLOR,
    fmt: o.hz ? fmtHz : fmt2,
    ...(o.hz ? { curve: 'log' as const } : {}),
  });
}
