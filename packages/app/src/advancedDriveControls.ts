/** Editor widgets share the rack's controls, the console knob, palette, and engine ranges/defaults. */
import { insertSelect, insertSwitch } from './insertLayout';
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
  return insertSelect({
    label,
    options: values.map((v, i) => [v, labels[i] ?? v] as const),
    value,
    change: set,
  });
}
export const driveToggle = insertSwitch;
interface NumericControl {
  label: string;
  bounds: readonly [number, number];
  def: number;
  get: () => number;
  set: (value: number) => void;
  hz?: boolean;
  /** The rack's big dial, standing alone in its column. */
  big?: boolean | undefined;
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
    dial: o.big ? 'rack-big' : 'rack',
    fmt: o.hz ? fmtHz : fmt2,
    ...(o.hz ? { curve: 'log' as const } : {}),
  });
}
