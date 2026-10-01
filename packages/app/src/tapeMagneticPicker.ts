/**
 * The Tape card's hidden magnetic picker (windsor#276): shown only under
 * `?tapeDev`, one select per Tape insert that sends the live stage an
 * allowed core point through the engine's `setTapeMagneticOverride`, or the
 * model's row back. Nothing here calls `ctx.change`: the choice lives in
 * `tapeMagneticPickerModel.ts`'s session, keyed by the live stage, and never
 * in the song.
 */
import { setTapeMagneticOverride } from '@windsor/engine';
import type { AppCtx } from './context';
import { insertSelect } from './insertLayout';
import { liveInsert, type InsertTarget } from './insertTarget';
import {
  createMagneticOverrides,
  magneticOptions,
  tapeDevEnabled,
} from './tapeMagneticPickerModel';
import {
  TAPE_MAGNETIC_NO_AUDIO,
  TAPE_MAGNETIC_PICKER_HINT,
  TAPE_MAGNETIC_PICKER_LABEL,
} from './tapeMagneticPickerTables';

/** The page's one session: every Tape card's picker reads and writes it. */
const OVERRIDES = createMagneticOverrides();
const OPTIONS = magneticOptions();

/** Whether this page shows the picker. */
export const showsMagneticPicker = (): boolean => tapeDevEnabled(location.search);

/** The picker for the Tape insert at `index` of `target`'s chain. */
export function magneticPicker(ctx: AppCtx, target: InsertTarget, index: number): HTMLElement {
  const wrap = insertSelect({
    label: TAPE_MAGNETIC_PICKER_LABEL,
    options: OPTIONS,
    value: OVERRIDES.value(liveInsert(ctx, target, index)),
    change: (value) => {
      const stage = liveInsert(ctx, target, index);
      if (OVERRIDES.choose(stage, value, (row) => setTapeMagneticOverride(stage, row))) return;
      if (!stage) ctx.notify(TAPE_MAGNETIC_NO_AUDIO, 'info');
      const select = wrap.querySelector('select');
      if (select) select.value = OVERRIDES.value(stage);
    },
  });
  wrap.title = TAPE_MAGNETIC_PICKER_HINT;
  wrap.classList.add('tape-dev-picker');
  return wrap;
}
