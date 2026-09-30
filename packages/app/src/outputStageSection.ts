/**
 * The output stage's controls in the master column (windsor#94 decision 1,
 * windsor#194 decision 2; the mockup's `.modes.grid2`, `.toggle` and Ceiling
 * knob): the mode as a two-by-two segmented control (Limiter, Soft clip,
 * Hard clip, Off), the Lookahead toggle, live in Limiter only, and the
 * Ceiling knob, over the song's `master.output`. Every edit is one
 * `ctx.change` with the whole `output` (`outputEdit`, through the link), so
 * it reaches the live stage and the document together, autosaves with the
 * song, and redraws the column's other parts at once.
 */
import { OUTPUT_LIMITER, OUTPUT_STAGE_MODES } from '@windsor/engine';
import type { OutputStageMode } from '@windsor/engine';
import { el, seg } from './dom';
import { type KnobElement, makeKnob } from './knob';
import { lookaheadEnabled } from './outputStageModel';
import type { OutputStageLink } from './outputStageLink';
import { OUTPUT_CEILING_KNOB, OUTPUT_MODE_LABELS } from './outputStageTables';

export interface OutputStageControls {
  /** The mode grid over the Lookahead toggle. */
  readonly modes: HTMLElement;
  readonly ceiling: KnobElement;
}

function lookaheadToggle(link: OutputStageLink): HTMLButtonElement {
  const toggle = el('button', 'stage-toggle') as HTMLButtonElement;
  toggle.type = 'button';
  const box = el('i');
  box.setAttribute('aria-hidden', 'true');
  toggle.append(box, document.createTextNode('Lookahead'));
  toggle.title = `Limiter only: delays the output ${OUTPUT_LIMITER.lookaheadMs} ms so the gain is down before a peak`;
  toggle.onclick = (): void => link.write({ lookahead: !link.settings().lookahead });
  const sync = (): void => {
    const { lookahead, mode } = link.settings();
    toggle.setAttribute('aria-pressed', String(lookahead));
    toggle.disabled = !lookaheadEnabled(mode);
  };
  link.onChange(sync);
  sync();
  return toggle;
}

export function outputStageControls(link: OutputStageLink): OutputStageControls {
  const mode = seg(
    OUTPUT_STAGE_MODES.map((value) => ({ value, label: OUTPUT_MODE_LABELS[value] })),
    () => link.settings().mode,
    (value) => link.write({ mode: value as OutputStageMode }),
  );
  mode.classList.add('stage-modes');
  mode.setAttribute('role', 'group');
  mode.setAttribute('aria-label', 'Output stage mode');
  const modes = el('div', 'stage-mode-stack');
  modes.append(mode, lookaheadToggle(link));
  const ceiling = makeKnob({
    ...OUTPUT_CEILING_KNOB,
    get: () => link.settings().ceilingDb,
    set: (ceilingDb) => link.write({ ceilingDb }),
  });
  return { modes, ceiling };
}
