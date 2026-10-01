/**
 * Tape model and randomization write the same song-owned insert as its
 * knobs. In the rack (windsor#175) Tape is the pages `TAPE_PAGES` lays out:
 * Tape (the type, oversampling and starting-point pickers, Randomize, and
 * the tone knobs)
 * and Motion (wow, flutter and dropouts). The on/off switch is the rack's
 * rail. Under `?tapeDev` the Tape page also carries the hidden magnetic
 * picker (windsor#276, `tapeMagneticPicker.ts`), which is never saved.
 */
import {
  DEFAULT_TAPE,
  TAPE_TYPES,
  TAPE_LABELS,
  randomiseTape,
  TAPE_PRESETS,
  applyTapePreset,
  type TapeSpec,
} from '@windsor/engine';
import type { AppCtx } from './context';
import type { InsertCard } from './insertCards';
import type { InsertTarget } from './insertTarget';
import { el } from './dom';
import { insertsOf } from './insertKnobs';
import { insertPage, insertSelect, knobColumns, wideColumn } from './insertLayout';
import { insertChange } from './insertTarget';
import { tapeKnobs } from './tapeKnobs';
import type { TapeControl } from './tapeTables';
import { TAPE_OVERSAMPLING_HINT, TAPE_OVERSAMPLING_OPTIONS, TAPE_PAGES } from './tapeTables';
import { withOversampling } from './tapeCardModel';
import { magneticPicker, showsMagneticPicker } from './tapeMagneticPicker';

interface TapeView {
  current(): TapeSpec;
  commit(spec: TapeSpec): void;
}

function randomButton(view: TapeView): HTMLElement {
  const random = el('button', 'btn', 'Randomize') as HTMLButtonElement;
  random.type = 'button';
  random.title = 'Roll a new tape character; keep Trim, Mix and bypass';
  random.onclick = (): void => view.commit(randomiseTape(view.current()));
  return random;
}

/**
 * The oversampling picker (windsor#246 decision 2, kept as a product setting): the magnetic core's factor,
 * committed like Tape type. The engine swaps to the other core on the running
 * insert, from zero state, so a click at the switch is expected.
 */
function oversamplingSelect(view: TapeView): HTMLElement {
  const select = insertSelect({
    label: 'Oversampling',
    options: TAPE_OVERSAMPLING_OPTIONS,
    value: String(view.current().oversampling),
    change: (value) => view.commit(withOversampling(view.current(), value)),
  });
  select.title = TAPE_OVERSAMPLING_HINT;
  return select;
}

/** The picker or button `control` names. */
function control(view: TapeView, name: TapeControl): HTMLElement {
  if (name === 'randomize') return randomButton(view);
  if (name === 'oversampling') return oversamplingSelect(view);
  if (name === 'model')
    return insertSelect({
      label: 'Tape type',
      options: TAPE_TYPES.map((value, i) => [value, TAPE_LABELS[i] ?? value] as const),
      value: view.current().model,
      change: (model) => view.commit({ ...view.current(), model: model as TapeSpec['model'] }),
    });
  return insertSelect({
    label: 'Starting point',
    ariaLabel: 'Tape starting point',
    options: [['', 'Choose…'], ...TAPE_PRESETS.map((entry) => [entry.id, entry.label] as const)],
    value: '',
    change: (id) => view.commit(applyTapePreset(view.current(), id)),
  });
}

export const tapeCard: InsertCard = (ctx: AppCtx, target: InsertTarget, index) => {
  const view: TapeView = {
    current: () => {
      const spec = insertsOf(ctx, target)[index];
      return spec?.kind === 'tape' ? spec : DEFAULT_TAPE;
    },
    commit: (spec) => {
      const inserts = [...insertsOf(ctx, target)];
      if (inserts[index]?.kind !== 'tape') return;
      inserts[index] = spec;
      if (ctx.change(insertChange(target, inserts)).ok) ctx.render();
    },
  };
  // The first page's column ends with the developer picker, only under the page's flag.
  const dev = (page: number): HTMLElement[] =>
    page === 0 && showsMagneticPicker() ? [magneticPicker(ctx, target, index)] : [];
  return TAPE_PAGES.map((page, i) => ({
    name: page.name,
    build: () => {
      const controls = [...page.controls.map((name) => control(view, name)), ...dev(i)];
      return insertPage(
        ...(controls.length ? [wideColumn(...controls)] : []),
        ...knobColumns(tapeKnobs(ctx, target, index, page.knobs)),
      );
    },
  }));
};
