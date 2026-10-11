/**
 * The Roll's automation host (windsor#708 decision 2; the host interface,
 * `automationEditHost.ts`, windsor#706): the Song tab's Edit, Draw and Shape
 * run over a roll's loop through this adapter, not a copy.
 *
 * - **The axis** is the loop as the roll draws it (no longer than the
 *   region), at the roll's px per tick; a point is written in loop ticks.
 * - **The lane's height** is the note pane's visible height.
 * - **The snap** is the roll's one Snap, triplets included. Its Off (one
 *   tick) is the host's 0: a point lands on the nearest tick, and Draw
 *   samples at the Song tab's Off grain, as the tool's hint says.
 * - **The tool** is the Envelopes tab's (`RollViewState.envelope`), and
 *   so are the Shape tool's last settings: the roll's, never the Song
 *   tab's.
 */
import type { Meter } from '@windsor/engine';
import { ticksPerBar } from '@windsor/engine';
import type { AutomationEditHost, AutomationToolState } from './automationEditHost';
import { type RollSnap, ROLL_SNAP_OFF_TICKS } from './rollTables';
import { type RollViewState, snapOf } from './rollView';
import type { AutomationTool } from './songAutomationTables';
import type { ShapeSettings } from './songShapeTables';

/** The host's Snap grain for the roll's `snap`: its ticks, and Off as 0. */
export const envelopeSnapTicks = (snap: RollSnap): number =>
  snap.ticks <= ROLL_SNAP_OFF_TICKS ? 0 : snap.ticks;

/** The loop as the roll draws it: never past the region. */
export const envelopeAxisTicks = (loopTicks: number, regionTicks: number): number =>
  Math.min(loopTicks, regionTicks);

/** The roll's frame now: its px per tick, loop and region, the pane's height, and the song's meter. */
export interface RollEnvelopeFrame {
  readonly pxPerTick: number;
  readonly loopTicks: number;
  readonly regionTicks: number;
  readonly heightPx: number;
  readonly meter: Meter | undefined;
}

/** The roll's Envelopes tab state as the host's tool state, read and written live. */
export function envelopeTools(view: RollViewState): AutomationToolState {
  return {
    get automationTool(): AutomationTool {
      return view.envelope.tool;
    },
    set automationTool(tool: AutomationTool) {
      view.envelope.tool = tool;
    },
    get automationSnap(): number {
      return envelopeSnapTicks(snapOf(view.snap));
    },
    set automationSnap(_ticks: number) {
      // The roll's Snap control owns the grain; nothing here picks it.
    },
    get shape(): ShapeSettings {
      return view.envelope.shape;
    },
    set shape(settings: ShapeSettings) {
      view.envelope.shape = settings;
    },
  };
}

/** The roll as an automation host, reading its frame from `frame` on each call. */
export function rollEnvelopeHost(
  view: RollViewState,
  frame: () => RollEnvelopeFrame,
): AutomationEditHost {
  return {
    tools: envelopeTools(view),
    pxPerBar: () => frame().pxPerTick * ticksPerBar(frame().meter),
    meter: () => frame().meter,
    laneHeightPx: () => frame().heightPx,
    axisTicks: () => envelopeAxisTicks(frame().loopTicks, frame().regionTicks),
  };
}
