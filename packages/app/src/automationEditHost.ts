/**
 * What the automation editing works over (windsor#706, epic windsor#699
 * decision 3): the Edit, Draw and Shape gestures, the Shape range and its
 * popover, the tool toolbar and the curve painting read their time axis and
 * their tool state through this host, never through a view.
 *
 * - **The axis** runs from tick 0 to `axisTicks`: the song's length on the
 *   Song tab (`songAutomationHost.ts`), a roll's loop in its envelopes.
 * - **The frame**: px one bar spans, the meter whose bar that is, and the
 *   lane's height.
 * - **The tools**: the current tool, the Snap grain and the Shape tool's
 *   last settings, which the toolbar writes and the gestures read.
 */
import type { Meter } from '@windsor/engine';
import { ticksPerBar } from '@windsor/engine';
import type { CurveFrame } from './songAutomationCurve';
import type { LaneFrame } from './songAutomationEdit';
import type { AutomationTool } from './songAutomationTables';
import type { ShapeSettings } from './songShapeTables';
import { tickToPx } from './songViewTables';

/** The toolbar's state: the tool, the Snap grain in ticks (0 for Off) and the Shape tool's last settings. */
export interface AutomationToolState {
  automationTool: AutomationTool;
  automationSnap: number;
  shape: ShapeSettings;
}

/** The axis, the frame and the tools one lane is edited over. */
export interface AutomationEditHost {
  readonly tools: AutomationToolState;
  /** The px one bar spans. */
  pxPerBar(): number;
  /** The meter whose bar `pxPerBar` spans, which the Shape readout counts in; 4/4 when absent. */
  meter(): Meter | undefined;
  /** The lane's height in px. */
  laneHeightPx(): number;
  /** The axis's length in ticks, from tick 0. */
  axisTicks(): number;
}

/** One bar of the host's meter, in ticks. */
export const hostBarTicks = (host: AutomationEditHost): number => ticksPerBar(host.meter());

/** Where the host's lane is drawn now. */
export const hostFrame = (host: AutomationEditHost): LaneFrame => ({
  pxPerBar: host.pxPerBar(),
  ticksPerBar: hostBarTicks(host),
  heightPx: host.laneHeightPx(),
  axisTicks: host.axisTicks(),
});

/** The host's lane as its curve draws: the whole axis wide, at the host's zoom. */
export function hostCurveFrame(host: AutomationEditHost): CurveFrame {
  const pxPerBar = host.pxPerBar();
  const bar = hostBarTicks(host);
  const widthPx = tickToPx(host.axisTicks(), pxPerBar, bar);
  return { widthPx, heightPx: host.laneHeightPx(), pxPerBar, ticksPerBar: bar };
}
