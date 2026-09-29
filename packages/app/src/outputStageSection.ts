/**
 * The master strip's Output section (windsor#94 decision 1): the output
 * stage's mode, Ceiling and Lookahead over the song's `master.output`, and
 * its meters (`outputStageMeters.ts`). Every edit is one `ctx.change` with the
 * whole `output` (`outputEdit`), so it reaches the live stage and the
 * document together and autosaves with the song.
 */
import { OUTPUT_LIMITER, OUTPUT_STAGE_MODES, masterOutput } from '@windsor/engine';
import type { OutputStageSettings } from '@windsor/engine';
import type { AppCtx } from './context';
import { el, section, seg } from './dom';
import { makeKnob } from './knob';
import { lookaheadEnabled, outputEdit } from './outputStageModel';
import { outputStageMeters } from './outputStageMeters';
import { OUTPUT_CEILING_KNOB, OUTPUT_MODE_LABELS } from './outputStageTables';

export interface OutputStageSection {
  readonly root: HTMLElement;
  /** Clear the clip light; the master meter's Reset peaks calls it. */
  resetClip(): void;
}

export function outputStageSection(ctx: AppCtx): OutputStageSection {
  const view = section(
    'Output',
    'The last stage before the speakers. The peaks here read in and out of it.',
  );
  view.root.classList.add('output-stage');
  const settings = (): OutputStageSettings => masterOutput(ctx.model.doc.master);
  const write = (edit: Partial<OutputStageSettings>): void =>
    void ctx.change(outputEdit(ctx.model.doc.master, edit));

  const lookahead = el('button', 'btn output-lookahead', 'Lookahead') as HTMLButtonElement;
  lookahead.type = 'button';
  lookahead.title = `Limiter only: delays the output ${OUTPUT_LIMITER.lookaheadMs} ms so the gain is down before a peak`;
  const meters = outputStageMeters(ctx);
  const sync = (): void => {
    const current = settings();
    lookahead.setAttribute('aria-pressed', String(current.lookahead));
    lookahead.disabled = !lookaheadEnabled(current.mode);
    meters.refresh();
  };
  lookahead.onclick = (): void => {
    write({ lookahead: !settings().lookahead });
    sync();
  };

  const mode = seg(
    OUTPUT_STAGE_MODES.map((value) => ({ value, label: OUTPUT_MODE_LABELS[value] })),
    () => settings().mode,
    (value) => {
      write({ mode: value as OutputStageSettings['mode'] });
      sync();
    },
  );
  mode.classList.add('output-mode');
  mode.setAttribute('aria-label', 'Output stage mode');
  const ceiling = makeKnob({
    ...OUTPUT_CEILING_KNOB,
    get: () => settings().ceilingDb,
    set: (ceilingDb) => write({ ceilingDb }),
  });
  const controls = el('div', 'output-stage-controls');
  controls.append(mode, ceiling, lookahead);
  view.body.append(controls, meters.root);
  sync();
  return { root: view.root, resetClip: meters.resetClip };
}
