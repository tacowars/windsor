/**
 * The roll as the automation editing's host (windsor#708 decision 2): the
 * axis is the loop as drawn, at the roll's px per tick; the snap is the
 * roll's, triplets included, Off as the host's 0; and the tool and the
 * Shape settings are the Envelopes tab's own, read and written live.
 */
import { describe, expect, it } from 'vitest';

import { TICKS_PER_BAR } from '@windsor/engine';
import { envelopeSnapTicks, rollEnvelopeHost } from './rollEnvelopeHost';
import { ROLL_SNAPS } from './rollTables';
import { defaultRollView } from './rollView';

const BAR = TICKS_PER_BAR;

describe("the roll's automation host", () => {
  const view = defaultRollView();
  const frame = { pxPerTick: 2, loopTicks: 4 * BAR, regionTicks: 2 * BAR, heightPx: 90 };
  const host = rollEnvelopeHost(view, () => ({ ...frame, meter: undefined }));

  it('runs over the loop as drawn, never past the region, at the roll’s zoom', () => {
    expect(host.axisTicks()).toBe(2 * BAR);
    expect(host.pxPerBar()).toBe(2 * BAR);
    expect(host.laneHeightPx()).toBe(90);
  });

  it("snaps on the roll's Snap, its triplets kept and its Off as any tick", () => {
    expect(ROLL_SNAPS.map(envelopeSnapTicks)).toEqual([24, 12, 8, 6, 4, 3, 0]);
    view.snap = 2;
    expect(host.tools.automationSnap).toBe(8);
  });

  it("reads and writes the Envelopes tab's tool and Shape settings, not the Song tab's", () => {
    host.tools.automationTool = 'draw';
    expect(view.envelope.tool).toBe('draw');
    const settings = { kind: 'sine', rateTicks: BAR, phase: 0.25, duty: 0.5 } as const;
    host.tools.shape = settings;
    expect(view.envelope.shape).toBe(settings);
  });
});
