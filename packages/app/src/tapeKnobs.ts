/** Tape's legacy macro becomes independent values atomically on the first motion edit. */
import { DEFAULT_TAPE, tapeControlValue, setTapeControl, type TapeNumber } from '@windsor/engine';
import type { AppCtx } from './context';
import type { InsertTarget } from './insertTarget';
import { insertsOf, insertChange } from './insertTarget';
import { makeKnob } from './knob';
import { STRIP_COLOR } from './consoleColors';
import { TAPE_KNOBS } from './tapeTables';

/** The knobs for `fields`, in that order, at the rack's small dial. */
export function tapeKnobs(
  ctx: AppCtx,
  target: InsertTarget,
  index: number,
  fields: readonly TapeNumber[],
): HTMLElement[] {
  return fields.flatMap((field) =>
    TAPE_KNOBS.filter((entry) => entry.f === field).map((entry) =>
      makeKnob({
        label: entry.label,
        ...entry.o,
        color: STRIP_COLOR,
        dial: 'rack',
        get: () => {
          const spec = insertsOf(ctx, target)[index];
          return tapeControlValue(spec?.kind === 'tape' ? spec : DEFAULT_TAPE, field);
        },
        set: (value) => {
          const inserts = [...insertsOf(ctx, target)],
            spec = inserts[index];
          if (spec?.kind !== 'tape') return;
          inserts[index] = setTapeControl(spec, field, value);
          ctx.change(insertChange(target, inserts));
        },
      }),
    ),
  );
}
