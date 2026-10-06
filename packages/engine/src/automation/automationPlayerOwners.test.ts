/**
 * The automation player keyed by owner (windsor#614, record
 * `2026-10-05-group-automation-folder-tracks` decision 4): a part's lanes
 * and a group's are held apart even when the slot and the id are equal, each
 * is removed and resynced on its own, and a group's lanes keep the timing
 * rules a part's do (record `2026-10-01-song-automation-lanes` decision 8):
 * the hold at a start, the loop's wrap, a seek and a stop.
 */
import { describe, expect, it } from 'vitest';

import {
  RIG_OWNER,
  RIG_SLOT,
  RIG_SONG_TICKS,
  RIG_START,
  automationRig,
  lane,
  point,
} from '../__fixtures__/automationRig';
import { valueAt } from './automationEvaluate';
import { groupOwner, isGroupOwner, ownerKey, partOwner, sameOwner } from './automationOwner';
import { requireCatalogRow } from './automationTargets';

const LEVEL = requireCatalogRow('strip.level');
/** 120 BPM straight. */
const TICK = 1 / 48;
const at = (tick: number): number => RIG_START + tick * TICK;

/** A group whose id is the rig part's slot, so only the owner's kind tells them apart. */
const GROUP = groupOwner(RIG_SLOT);
const FADE = lane('strip.level', [point(0, 0.25, 0.5), point(96, 1)]);
const DIP = lane('strip.level', [point(0, 1), point(96, 0.1)]);

describe('owners', () => {
  it('names a part by slot and a group by id, never the one for the other', () => {
    expect(partOwner(2)).toEqual({ part: 2 });
    expect(groupOwner(2)).toEqual({ group: 2 });
    expect(isGroupOwner(groupOwner(2))).toBe(true);
    expect(isGroupOwner(partOwner(2))).toBe(false);
    expect(ownerKey(partOwner(2))).not.toBe(ownerKey(groupOwner(2)));
    expect(sameOwner(groupOwner(2), { group: 2 })).toBe(true);
    expect(sameOwner(groupOwner(2), partOwner(2))).toBe(false);
  });
});

describe('the player, keyed by owner', () => {
  it('holds a part and a group with the same number apart, each on its own target', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    rig.player.setLanes(GROUP, [DIP]);
    expect(rig.player.owners()).toEqual([RIG_OWNER, GROUP]);
    expect(rig.player.lanesOf(RIG_OWNER)).toEqual([FADE]);
    expect(rig.player.lanesOf(GROUP)).toEqual([DIP]);
    rig.run(96);
    for (let tick = 0; tick < 96; tick++) {
      expect(rig.param('strip.level').valueAt(at(tick))).toBeCloseTo(
        valueAt(LEVEL, FADE.points, tick),
        12,
      );
      expect(rig.param('strip.level', GROUP).valueAt(at(tick))).toBeCloseTo(
        valueAt(LEVEL, DIP.points, tick),
        12,
      );
    }
  });

  it("forgets a removed group without touching its params or the part's lanes", () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    rig.player.setLanes(GROUP, [DIP]);
    const mark = rig.calls('strip.level', 0, GROUP).length;
    rig.player.remove(GROUP);
    expect(rig.player.owners()).toEqual([RIG_OWNER]);
    expect(rig.player.lanesOf(GROUP)).toEqual([]);
    rig.run(24);
    expect(rig.calls('strip.level', mark, GROUP)).toEqual([]);
    expect(rig.calls('strip.level').length).toBeGreaterThan(20);
  });

  it('resyncs one owner alone', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    rig.player.setLanes(GROUP, [DIP]);
    rig.run(12);
    rig.now = at(3);
    const part = rig.calls('strip.level').length;
    const group = rig.calls('strip.level', 0, GROUP).length;
    rig.player.resync(GROUP);
    expect(rig.calls('strip.level').length).toBe(part);
    expect(rig.calls('strip.level', group, GROUP).slice(0, 2)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: at(3) },
      { call: 'setValueAtTime', value: valueAt(LEVEL, DIP.points, 3), time: at(3) },
    ]);
  });
});

describe("a group's lanes keep the part rules", () => {
  it('holds at the first tick, and again at the loop back to the start', () => {
    const rig = automationRig();
    rig.player.setLanes(GROUP, [DIP]);
    const mark = rig.calls('strip.level', 0, GROUP).length;
    const times = rig.run(RIG_SONG_TICKS + 2);
    const calls = rig.calls('strip.level', mark, GROUP);
    expect(calls.slice(0, 2)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: times[0] },
      { call: 'setValueAtTime', value: 1, time: times[0] },
    ]);
    const wrap = times[RIG_SONG_TICKS]!;
    expect(calls.filter((c) => c.time === wrap).map((c) => [c.call, c.value])).toEqual([
      ['cancelScheduledValues', expect.any(Number)],
      ['setValueAtTime', 1],
    ]);
  });

  it('holds where the playhead stood on a stop, and at the new tick on a seek', () => {
    const rig = automationRig();
    rig.player.setLanes(GROUP, [DIP]);
    rig.run(12);
    rig.now = at(6);
    rig.player.stop();
    expect(rig.calls('strip.level', 0, GROUP).slice(-1)).toEqual([
      { call: 'setValueAtTime', value: valueAt(LEVEL, DIP.points, 6), time: at(6) },
    ]);
    rig.player.seek(48);
    expect(rig.calls('strip.level', 0, GROUP).slice(-1)).toEqual([
      { call: 'setValueAtTime', value: valueAt(LEVEL, DIP.points, 48), time: at(6) },
    ]);
  });

  it('plays a one-point lane as a hold, and a lane ending on the last tick to its end', () => {
    const rig = automationRig();
    const flat = lane('strip.pan', [point(24, -0.5)]);
    const toEnd = lane('strip.level', [point(0, 0.2), point(RIG_SONG_TICKS, 1)]);
    rig.player.setLanes(GROUP, [flat, toEnd]);
    rig.run(RIG_SONG_TICKS);
    expect(rig.param('strip.pan', GROUP).valueAt(at(RIG_SONG_TICKS - 1))).toBe(-0.5);
    expect(rig.param('strip.level', GROUP).valueAt(at(RIG_SONG_TICKS - 1))).toBeCloseTo(
      valueAt(LEVEL, toEnd.points, RIG_SONG_TICKS - 1),
      12,
    );
  });
});
