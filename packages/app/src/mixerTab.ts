/**
 * Mixer tab (#70, record §2; #435; windsor#194, record
 * `2026-09-30-master-column-and-meters`): two columns. The left one scrolls
 * with the page: the master's insert rack, then Send A and Send B, each a
 * level and an insert chain (windsor#172) in the document's `returns`
 * section (`returnsPanel.ts`), then the song's Groups (windsor#287,
 * `groupsPanel.ts`). The right one is the master column, sticky
 * below the header (`masterColumn.ts`). At `MASTER_STACK_MAX_WIDTH_PX` and
 * below it stacks above the racks, and the meter bridge (`meterBridge.ts`)
 * stands in for its meters once they scroll away. Each part's strip lives on
 * the Song tab's mixer (windsor#152).
 *
 * Every meter paints from one loop per render (`meterLoop.ts`), running only
 * while the tab is shown, the page is visible and a meter is on screen.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { renderMasterColumn } from './masterColumn';
import {
  MASTER_COLUMN_GAP_PX,
  MASTER_COLUMN_WIDTH_PX,
  MASTER_STICKY_GAP_PX,
} from './masterColumnTables';
import { renderMasterInserts } from './masterStrip';
import { browserMeterEnvironment, createMeterLoop } from './meterLoop';
import { renderMeterBridge } from './meterBridge';
import { createOutputStageLink } from './outputStageLink';
import { renderReturnsSection } from './returnsPanel';
import { renderGroupsSection } from './groupsPanel';
import { followChromeHeight } from './stickyOffset';

/** The last render's loop and bridge observer, ended when the tab renders again. */
let teardown: (() => void) | null = null;

export function renderMixerTab(body: HTMLElement, ctx: AppCtx): void {
  teardown?.();
  body.innerHTML = '';
  followChromeHeight();
  const layout = el('div', 'mixer-layout');
  layout.style.setProperty('--master-col-w', `${MASTER_COLUMN_WIDTH_PX}px`);
  layout.style.setProperty('--master-gap', `${MASTER_COLUMN_GAP_PX}px`);
  layout.style.setProperty('--master-sticky-gap', `${MASTER_STICKY_GAP_PX}px`);
  const link = createOutputStageLink(ctx);
  const loop = createMeterLoop({
    ...browserMeterEnvironment(),
    root: layout,
    onTabShown: (listener) => ctx.onTabShown('mixer', listener),
    revision: link.revision,
  });
  const column = renderMasterColumn(ctx, link, loop);
  const bridge = renderMeterBridge(link, loop, column.meters);
  const racks = el('div', 'mixer-racks');
  racks.append(renderMasterInserts(ctx), renderReturnsSection(ctx), renderGroupsSection(ctx));
  layout.append(bridge.root, racks, column.root);
  body.appendChild(layout);
  teardown = () => {
    loop.end();
    bridge.disconnect();
  };
}
