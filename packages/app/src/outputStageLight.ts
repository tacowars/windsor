/**
 * The top-bar output light (windsor#94 decision 4): a dot beside the CPU
 * meter that glows while the output stage has acted within the last
 * `PEAK_METER.holdSeconds`, and shows unlit and outlined in Off mode. Its
 * tooltip names the mode. It is display only: it has no click.
 *
 * The rule is `outputStageModel.ts`'s `outputLight`; the stage's watch
 * (`outputStageWatch.ts`) says when it last acted. It rides the console's one
 * frame loop while audio is on and repaints only when its look changes.
 */
import type { OutputStageMode } from '@windsor/engine';
import { OUTPUT_STAGE_MODES, masterOutput } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { type OutputLightState, type OutputLightView, outputLight } from './outputStageModel';
import { watchOutputStage } from './outputStageWatch';
import { watchPlayhead } from './stepStrip';

const LIGHT_STATES: readonly OutputLightState[] = ['lit', 'unlit', 'off'];

/** One number per look, so the frame loop repaints only on a change. */
const lookKey = (mode: OutputStageMode, view: OutputLightView): number =>
  OUTPUT_STAGE_MODES.indexOf(mode) * LIGHT_STATES.length + LIGHT_STATES.indexOf(view.state);

/** The light, started on the shared frame loop; the caller places it. */
export function outputStageLight(ctx: AppCtx): HTMLElement {
  const light = el('span', 'output-light');
  light.setAttribute('role', 'img');
  let view: OutputLightView = outputLight(masterOutput(ctx.model.doc.master).mode, null, 0);

  const paint = (): void => {
    for (const state of LIGHT_STATES) light.classList.toggle(state, state === view.state);
    light.title = view.title;
    light.setAttribute('aria-label', view.title);
  };

  watchPlayhead({
    attached: () => light.isConnected,
    shown: () => ctx.host.enabled,
    playheadAt: () => {
      const mode = masterOutput(ctx.model.doc.master).mode;
      const stage = ctx.host.system?.engine.outputStage;
      const lastActedMs = stage ? watchOutputStage(stage).lastActedMs : null;
      view = outputLight(mode, lastActedMs, performance.now());
      return lookKey(mode, view);
    },
    mark: paint,
  });
  paint();
  return light;
}
