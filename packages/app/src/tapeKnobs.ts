/** Tape's legacy macro becomes independent values atomically on the first motion edit. */
import { DEFAULT_TAPE, tapeControlValue, setTapeControl, type TapeNumber } from '@windsor/engine';
import type { AppCtx } from './context';
import type { InsertTarget } from './insertTarget';
import { insertsOf, insertChange } from './insertTarget';
import { el } from './dom';
import { makeKnob } from './knob';
import { STRIP_COLOR } from './consoleColors';
import { TAPE_KNOBS } from './tapeTables';
export function tapeKnobs(ctx: AppCtx, target: InsertTarget, index: number): HTMLElement {
  const root = el('div', 'knob-row');
  for (const entry of TAPE_KNOBS) {
    const field = entry.f as TapeNumber;
    root.append(
      makeKnob({
        label: entry.label,
        ...entry.o,
        color: STRIP_COLOR,
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
    );
  }
  return root;
}
