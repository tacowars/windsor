/**
 * Tape model and randomization write the same song-owned insert as its
 * knobs. In the rack (windsor#175) Tape is the pages `TAPE_PAGES` lays out:
 * Tape (the type and starting-point pickers, Randomize, and the tone knobs)
 * and Motion (wow, flutter and dropouts). The on/off switch is the rack's
 * rail.
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
import { TAPE_PAGES } from './tapeTables';

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

/** The picker or button `control` names. */
function control(view: TapeView, name: TapeControl): HTMLElement {
  if (name === 'randomize') return randomButton(view);
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
  return TAPE_PAGES.map((page) => ({
    name: page.name,
    build: () =>
      insertPage(
        ...(page.controls.length
          ? [wideColumn(...page.controls.map((name) => control(view, name)))]
          : []),
        ...knobColumns(tapeKnobs(ctx, target, index, page.knobs)),
      ),
  }));
};
