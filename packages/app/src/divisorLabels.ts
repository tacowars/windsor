/**
 * The step pickers' names in the song's meter (windsor#431 decision 4): the
 * 96-tick whole note reads "1 bar" where it is one bar (4/4) and `1/1`
 * everywhere else. The value never changes; only its name does.
 */
import type { Meter } from '@windsor/engine';
import { DIVISORS, ticksPerBar } from '@windsor/engine';
import { DIVISOR_OPTIONS, WHOLE_NOTE_LABEL } from './sequencerConstants';

type Option = { value: string; label: string };

/** `options` named for `meter`: the whole note relabelled when the bar is not one. */
export function divisorOptions(
  meter?: Meter,
  options: readonly Option[] = DIVISOR_OPTIONS,
): readonly Option[] {
  if (ticksPerBar(meter) === DIVISORS.whole) return options;
  return options.map((o) =>
    Number(o.value) === DIVISORS.whole ? { ...o, label: WHOLE_NOTE_LABEL } : o,
  );
}

/** One step's name in `meter`, or its ticks for a step no picker offers. */
export const divisorLabel = (divisor: number, meter?: Meter): string =>
  divisorOptions(meter).find((o) => Number(o.value) === divisor)?.label ?? `${divisor}t`;
