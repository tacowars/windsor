/**
 * The switch scale (windsor#628, record `2026-10-06-insert-switch-lanes`
 * decisions 1 and 2): a lane on an insert's `enabled` holds each point's
 * value until the next, whatever the bend, reads `Off` / `On`, and the player
 * only ever sets it, never ramps.
 */
import { describe, expect, it } from 'vitest';

import {
  RIG_OWNER,
  RIG_SONG_TICKS,
  automationRig,
  lane,
  point,
} from '../__fixtures__/automationRig';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { fromDisplay, switchReading, toDisplay } from './automationDisplay';
import { rampsBetween, segmentValue, valueAt } from './automationEvaluate';
import { knobHandle, sameValue } from './automationHandles';
import { INSERT_SWITCH_ROW as ROW } from './automationInsertTables';
import { AutomationPlayer } from './automationPlayer';

const BAR = TICKS_PER_BAR;
/** On from the start, off over bar 2, on again from bar 3. */
const POINTS = [point(0, 1), point(BAR, 0), point(2 * BAR, 1)];

describe('a switch row', () => {
  it('runs from 0 to 1 and reads Off / On', () => {
    expect([ROW.min, ROW.max, ROW.scale]).toEqual([0, 1, 'switch']);
    expect([0, 0.49, 0.5, 1].map((v) => switchReading(v))).toEqual(['Off', 'Off', 'On', 'On']);
  });

  it('maps off to the bottom and on to the top, and a height back to off or on', () => {
    expect([toDisplay(ROW, 0), toDisplay(ROW, 1)]).toEqual([0, 1]);
    expect([0, 0.3, 0.5, 0.7, 1].map((y) => fromDisplay(ROW, y))).toEqual([0, 0, 1, 1, 1]);
  });
});

describe('a switch lane holds', () => {
  it('is 1 up to the next point and 0 from it, with no ramp, whatever the bend', () => {
    const bent = [point(0, 1, 0.8), point(BAR, 0, -0.5)];
    for (const tick of [0, 1, BAR / 2, BAR - 0.001]) {
      expect(valueAt(ROW, bent, tick), `tick ${tick}`).toBe(1);
      expect(segmentValue(ROW, bent[0]!, bent[1]!, tick)).toBe(1);
    }
    for (const tick of [BAR, BAR + 1, 10 * BAR]) expect(valueAt(ROW, bent, tick)).toBe(0);
  });

  it('turns off over bar 2 and back on at bar 3', () => {
    expect(valueAt(ROW, POINTS, BAR - 1)).toBe(1);
    expect(valueAt(ROW, POINTS, BAR)).toBe(0);
    expect(valueAt(ROW, POINTS, 2 * BAR - 1)).toBe(0);
    expect(valueAt(ROW, POINTS, 2 * BAR)).toBe(1);
  });

  it('holds a single point everywhere', () => {
    for (const tick of [0, BAR, 1e6]) expect(valueAt(ROW, [point(BAR, 0)], tick)).toBe(0);
  });

  it('gives only its points as breakpoints, never a cut inside a segment', () => {
    const window = { fromTick: 0, toTick: 3 * BAR };
    expect(rampsBetween(ROW, POINTS, window)).toEqual([
      { tick: 0, value: 1 },
      { tick: BAR, value: 0 },
      { tick: 2 * BAR, value: 1 },
    ]);
    expect(rampsBetween(ROW, POINTS, { fromTick: 1, toTick: BAR })).toEqual([]);
  });
});

/** A player whose every lane resolves to one fake param on the switch row. */
function switchRig() {
  const rig = automationRig();
  const param = rig.param('switch');
  const handle = knobHandle({
    params: [param as unknown as AudioParam],
    write: sameValue,
    resting: () => 1,
  });
  const player = new AutomationPlayer({
    transport: rig.transport,
    now: () => rig.now,
    resolve: () => ({ handle, row: ROW }),
    songTicks: RIG_SONG_TICKS,
    restTick: 0,
  });
  return { rig, param, player };
}

describe('the player on a switch lane', () => {
  it('schedules only sets, at each point, a step included', () => {
    const { rig, param, player } = switchRig();
    const stepped = [...POINTS, point(2 * BAR + 12, 0), point(2 * BAR + 12, 1)];
    player.setLanes(RIG_OWNER, [lane('insert.f1.enabled', stepped)]);
    rig.run(3 * BAR);
    const calls = param.automation.filter((c) => c.call !== 'cancelScheduledValues');
    expect(calls.every((c) => c.call === 'setValueAtTime')).toBe(true);
    // The hold at the start, then each point after it, a step's two at one time.
    expect(calls.map((c) => c.value)).toEqual([1, 1, 0, 1, 0, 1]);
    const times = calls.map((c) => c.time!);
    expect(times[4]).toBe(times[5]);
    expect(param.valueAt(times[2]! - 1e-6)).toBe(1);
    expect(param.valueAt(times[2]!)).toBe(0);
    expect(param.valueAt(times[3]!)).toBe(1);
    player.dispose();
  });

  it('holds a lane with one point', () => {
    const { rig, param, player } = switchRig();
    player.setLanes(RIG_OWNER, [lane('insert.f1.enabled', [point(0, 0)])]);
    rig.run(BAR);
    expect(param.automation.filter((c) => c.call === 'linearRampToValueAtTime')).toEqual([]);
    expect(param.value).toBe(0);
    player.dispose();
  });

  it('turns off on the song’s last tick, and back on where the song wraps', () => {
    const { rig, param, player } = switchRig();
    const last = RIG_SONG_TICKS - 1;
    player.setLanes(RIG_OWNER, [lane('insert.f1.enabled', [point(0, 1), point(last, 0)])]);
    const times = rig.run(RIG_SONG_TICKS + 2);
    expect(param.automation.filter((c) => c.call === 'linearRampToValueAtTime')).toEqual([]);
    expect(param.valueAt(times[last - 1]!)).toBe(1);
    expect(param.valueAt(times[last]!)).toBe(0);
    // The wrap is a jump: the lane is held at the song's start, where it is on.
    expect(param.valueAt(times[RIG_SONG_TICKS]!)).toBe(1);
    player.dispose();
  });
});
