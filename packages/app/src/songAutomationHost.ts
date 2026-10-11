/**
 * The Song tab's automation host (windsor#706): the Song view's state mapped
 * one to one onto `AutomationEditHost`, so the lanes' gestures, Shape tool,
 * toolbar and curves run over the song's own axis, from tick 0 to its
 * length, at the view's zoom.
 */
import type { AutomationEditHost } from './automationEditHost';
import type { SongView } from './songTab';
import { SONG_VIEW } from './songViewTables';

/** The Song view as the automation editing's host. */
export const songAutomationHost = (view: SongView): AutomationEditHost => ({
  tools: view.state,
  pxPerBar: () => view.state.pxPerBar,
  meter: () => view.ctx.model.doc.transport.meter,
  laneHeightPx: () => SONG_VIEW.automationLanePx,
  axisTicks: () => view.songTicks(),
});
