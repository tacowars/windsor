/**
 * The automation editing over a host's axis (windsor#706): on a 2-bar axis,
 * as a roll's loop will be, a point, a Draw stroke and a Shape range clamp
 * to the host's length, not the song's.
 */
import { describe, expect, it } from 'vitest';
import { PPQ, TICKS_PER_BAR } from '@windsor/engine';
import { hostCurveFrame, hostFrame, type AutomationEditHost } from './automationEditHost';
import { snapTick, strokeTo, tickAtPx } from './songAutomationEdit';
import { DEFAULT_AUTOMATION_TOOL } from './songAutomationTables';
import { shapeRange } from './songShapeModel';
import { DEFAULT_SHAPE_SETTINGS } from './songShapeTables';

const BAR = TICKS_PER_BAR;
const SIXTEENTH = PPQ / 4;
const PX_PER_BAR = 96;
const LOOP = 2 * BAR;
const host: AutomationEditHost = {
  tools: {
    automationTool: DEFAULT_AUTOMATION_TOOL,
    automationSnap: SIXTEENTH,
    shape: DEFAULT_SHAPE_SETTINGS,
  },
  pxPerBar: () => PX_PER_BAR,
  meter: () => undefined,
  laneHeightPx: () => 56,
  axisTicks: () => LOOP,
};

describe('a 2-bar host axis', () => {
  it('is as wide as its two bars', () => {
    expect(hostCurveFrame(host).widthPx).toBe(2 * PX_PER_BAR);
  });

  it('clamps a point dragged past its end', () => {
    const tick = tickAtPx(3 * PX_PER_BAR, hostFrame(host));
    expect(tick).toBe(LOOP);
    expect(snapTick(LOOP + BAR, host.tools.automationSnap, host.axisTicks())).toBe(LOOP);
  });

  it('clamps a Draw stroke that runs past its end', () => {
    const samples = new Map<number, number>();
    const grain = { ticks: BAR / 2, axisTicks: host.axisTicks() };
    strokeTo(samples, null, { tick: BAR, display: 0 }, grain);
    strokeTo(samples, { tick: BAR, display: 0 }, { tick: 3 * BAR, display: 1 }, grain);
    expect(Math.max(...samples.keys())).toBe(LOOP);
  });

  it('keeps a Shape press on its last bar inside it', () => {
    const press = { pressTick: LOOP, fromTick: LOOP, toTick: LOOP, dragged: false };
    expect(shapeRange(press, host.axisTicks())).toEqual({ startTick: BAR, endTick: LOOP });
  });
});
