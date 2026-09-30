/**
 * The Mixer tab's master column (windsor#194 decision 2; record
 * `2026-09-30-master-column-and-meters`, decision 2; the mockup's option B):
 * everything after the master inserts, top to bottom:
 *
 * - "Master out", with the stage lamp;
 * - the meters: the Level fader, In L and R with clip LEDs, the dBFS scale
 *   In and Out share, Out L and R with the ceiling line, and the GR bar, with
 *   "In" and "Out" captions under each pair;
 * - the mode's two-by-two control and the Lookahead toggle;
 * - the transfer curve beside the Ceiling knob.
 *
 * Every moving part is registered on the tab's meter loop, so nothing here
 * paints while the column is hidden or off screen.
 */
import { DEFAULT_MASTER } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { createLevelFader } from './levelFader';
import {
  LEVEL_FADER_WIDTH_PX,
  MASTER_CHANNEL_WIDTH_PX,
  MASTER_METER_HEIGHT_PX,
} from './masterColumnTables';
import type { MeterLoop } from './meterLoop';
import type { OutputStageLink } from './outputStageLink';
import { createStageMeters } from './outputStageMeters';
import { outputStageControls } from './outputStageSection';
import { createStageLamp } from './stageLamp';
import { createTransferCurve } from './transferCurve';

export interface MasterColumn {
  readonly root: HTMLElement;
  /** The meters' row: the bridge shows while it is out of view. */
  readonly meters: HTMLElement;
}

/** The "In" and "Out" captions, each under its pair of bars. */
function captions(): HTMLElement {
  const row = el('div', 'master-captions');
  row.setAttribute('aria-hidden', 'true');
  for (const [text, cls] of [
    ['', 'is-fader'],
    ['In', 'is-pair'],
    ['', 'is-scale'],
    ['Out', 'is-pair'],
    ['', 'is-one'],
  ] as const) {
    row.appendChild(el('span', cls, text));
  }
  return row;
}

function header(link: OutputStageLink, loop: MeterLoop<Element>): HTMLElement {
  const head = el('div', 'master-column-head');
  const lamp = createStageLamp(link);
  loop.add(lamp);
  head.append(el('h2', 'master-column-title', 'Master out'), lamp.root);
  return head;
}

function meterRow(ctx: AppCtx, link: OutputStageLink, loop: MeterLoop<Element>): HTMLElement {
  const row = el('div', 'master-meters');
  const meters = createStageMeters(link, {
    heightPx: MASTER_METER_HEIGHT_PX,
    channelPx: MASTER_CHANNEL_WIDTH_PX,
  });
  const fader = createLevelFader({
    heightPx: MASTER_METER_HEIGHT_PX,
    get: () => ctx.model.doc.master?.level ?? DEFAULT_MASTER.level,
    set: (level) => void ctx.change({ master: { level } }),
  });
  row.append(
    fader,
    ...meters.inputs.map((bar) => bar.root),
    meters.scale,
    ...meters.outputs.map((bar) => bar.root),
    meters.reduction.root,
  );
  loop.add({ root: row, paint: meters.paint, reset: meters.reset });
  return row;
}

export function renderMasterColumn(
  ctx: AppCtx,
  link: OutputStageLink,
  loop: MeterLoop<Element>,
): MasterColumn {
  const root = el('aside', 'master-column');
  root.setAttribute('aria-label', 'Master level and output');
  root.style.setProperty('--meter-ch-w', `${MASTER_CHANNEL_WIDTH_PX}px`);
  root.style.setProperty('--fader-w', `${LEVEL_FADER_WIDTH_PX}px`);
  const meters = meterRow(ctx, link, loop);
  const controls = outputStageControls(link);
  const curve = createTransferCurve(link);
  loop.add(curve);
  const shape = el('div', 'master-shape');
  shape.append(curve.root, controls.ceiling);
  root.append(header(link, loop), meters, captions(), controls.modes, shape);
  const syncMode = (): void => void root.classList.toggle('is-off', link.settings().mode === 'off');
  link.onChange(syncMode);
  syncMode();
  return { root, meters };
}
