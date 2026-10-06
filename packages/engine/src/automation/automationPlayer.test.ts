/**
 * The automation player (windsor#344) against a hand-driven transport and
 * fake params: what each lane schedules tick by tick, a step's de-click, and
 * the restart every discontinuity makes (start, seek, stop, the loop's jump,
 * a tempo change, a live lane edit), plus a lane turned off and a song with
 * no lanes.
 */
import { describe, expect, it } from 'vitest';

import {
  RIG_OWNER,
  RIG_RESTING,
  RIG_SLOT,
  RIG_SONG_TICKS,
  RIG_START,
  automationRig,
  lane,
  point,
} from '../__fixtures__/automationRig';
import { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { AUTOMATION_STEP_RAMP_SECONDS } from './automationConstants';
import { valueAt } from './automationEvaluate';
import { knobHandle, sameValue } from './automationHandles';
import { partOwner } from './automationOwner';
import { AutomationPlayer } from './automationPlayer';
import { requireCatalogRow } from './automationTargets';

const LEVEL = requireCatalogRow('strip.level');
const PAN = requireCatalogRow('strip.pan');
/** 120 BPM straight. */
const TICK = 1 / 48;
const at = (tick: number): number => RIG_START + tick * TICK;

/** A bent fade on the level lane over a bar, then a flat hold. */
const FADE = lane('strip.level', [point(0, 0.25, 0.5), point(96, 1)]);
/** A pan sweep: straight, so a linear row adds one cut per tick while it runs. */
const SWEEP = lane('strip.pan', [point(0, -1), point(192, 1)]);

describe('the player, tick by tick', () => {
  it('holds a lane at the rest tick when it is set, and engages its handle', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    expect(rig.calls('strip.level')).toEqual([
      { call: 'cancelScheduledValues', value: RIG_RESTING, time: 0 },
      { call: 'setValueAtTime', value: 0.25, time: 0 },
    ]);
    expect(rig.handle('strip.level').engaged).toBe(true);
  });

  it('schedules a bent segment cut every tick across the look-ahead', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    const mark = rig.calls('strip.level').length;
    const times = rig.run(24);
    const calls = rig.calls('strip.level', mark);
    // The first tick is a start: cancel and hold at its time.
    expect(calls.slice(0, 2)).toEqual([
      { call: 'cancelScheduledValues', value: 0.25, time: times[0] },
      { call: 'setValueAtTime', value: 0.25, time: times[0] },
    ]);
    const ramps = calls.slice(2);
    expect(ramps).toHaveLength(23);
    ramps.forEach((ramp, i) => {
      const tick = i + 1;
      expect(ramp.call).toBe('linearRampToValueAtTime');
      expect(ramp.time).toBeCloseTo(at(tick), 12);
      expect(ramp.value).toBe(valueAt(LEVEL, FADE.points, tick));
    });
  });

  it('traces the curve: the param at every tick is the lane there', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE, SWEEP]);
    rig.run(2 * 96);
    for (let tick = 0; tick < 2 * 96; tick++) {
      expect(rig.param('strip.level').valueAt(at(tick))).toBeCloseTo(
        valueAt(LEVEL, FADE.points, tick),
        12,
      );
      expect(rig.param('strip.pan').valueAt(at(tick))).toBeCloseTo(
        valueAt(PAN, SWEEP.points, tick),
        12,
      );
    }
  });

  it('turns a step into set-then-ramp over the de-click', () => {
    const rig = automationRig();
    const step = lane('strip.level', [point(0, 0.5), point(24, 0.5), point(24, 1)]);
    rig.player.setLanes(RIG_OWNER, [step]);
    const mark = rig.calls('strip.level').length;
    const edge = rig.run(30)[24]!;
    const calls = rig.calls('strip.level', mark).slice(2);
    expect(calls).toEqual([
      { call: 'linearRampToValueAtTime', value: 0.5, time: edge },
      { call: 'setValueAtTime', value: 0.5, time: edge },
      { call: 'linearRampToValueAtTime', value: 1, time: edge + AUTOMATION_STEP_RAMP_SECONDS },
    ]);
  });

  it('schedules nothing for a song with no lanes, or with its lanes off', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, []);
    rig.player.setLanes(partOwner(RIG_SLOT + 1), [{ ...FADE, on: false }]);
    rig.run(96);
    rig.player.stop();
    expect(rig.calls('strip.level')).toEqual([]);
    expect(rig.calls('strip.level', 0, partOwner(RIG_SLOT + 1))).toEqual([]);
  });
});

describe('discontinuities: cancel, hold at the current tick, schedule again', () => {
  it('starts from a non-zero tick holding the value there', () => {
    const rig = automationRig(48);
    rig.player.setLanes(RIG_OWNER, [FADE]);
    expect(rig.calls('strip.level')[1]).toEqual({
      call: 'setValueAtTime',
      value: valueAt(LEVEL, FADE.points, 48),
      time: 0,
    });
    const mark = rig.calls('strip.level').length;
    const [first] = rig.run(2);
    expect(rig.calls('strip.level', mark)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: first },
      { call: 'setValueAtTime', value: valueAt(LEVEL, FADE.points, 48), time: first },
      { call: 'linearRampToValueAtTime', value: valueAt(LEVEL, FADE.points, 49), time: at(49) },
    ]);
  });

  it('holds the value at the new tick on a seek while stopped', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    rig.now = 5;
    const mark = rig.calls('strip.level').length;
    rig.player.seek(60);
    expect(rig.calls('strip.level', mark)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: 5 },
      { call: 'setValueAtTime', value: valueAt(LEVEL, FADE.points, 60), time: 5 },
    ]);
  });

  it('holds the value where the playhead stood on a stop, and restarts with a hold', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    rig.run(24);
    rig.now = at(10.5);
    const mark = rig.calls('strip.level').length;
    rig.player.stop();
    expect(rig.calls('strip.level', mark)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: rig.now },
      { call: 'setValueAtTime', value: valueAt(LEVEL, FADE.points, 10.5), time: rig.now },
    ]);
    expect(rig.player.running).toBe(false);
    // Resuming where the transport stopped is a discontinuity too.
    const resumed = rig.calls('strip.level').length;
    const [time] = rig.run(1);
    expect(rig.calls('strip.level', resumed).slice(0, 2)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time },
      { call: 'setValueAtTime', value: valueAt(LEVEL, FADE.points, 24), time },
    ]);
  });

  it("holds the loop start's value at the loop's jump back", () => {
    const rig = automationRig();
    rig.transport.loop = { start: 0, end: 24, songTicks: RIG_SONG_TICKS };
    rig.player.setLanes(RIG_OWNER, [FADE]);
    const times = rig.run(26);
    const jump = times[24]!;
    const calls = rig.calls('strip.level').filter((c) => c.time === jump);
    expect(calls).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: jump },
      { call: 'setValueAtTime', value: 0.25, time: jump },
    ]);
  });

  it('holds and reschedules from now on a tempo change, keeping the ticks already issued', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    const times = rig.run(12);
    rig.now = at(4);
    rig.transport.bpm = 60;
    const mark = rig.calls('strip.level').length;
    rig.player.resync();
    const calls = rig.calls('strip.level', mark);
    expect(calls.slice(0, 2)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: at(4) },
      { call: 'setValueAtTime', value: valueAt(LEVEL, FADE.points, 4), time: at(4) },
    ]);
    // Ticks 5–11 were issued before the change and keep their times.
    expect(calls.slice(2).map((c) => c.time)).toEqual(times.slice(5));
    // The next tick is issued at the new tempo, and continues the curve.
    const [next] = rig.run(2).slice(1);
    expect(next! - times[11]!).toBeCloseTo(TICK + 2 * TICK, 12);
  });

  it('cancels from now and schedules the new curve on a live lane edit while playing', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    const times = rig.run(12);
    rig.now = at(6);
    const edited = lane('strip.level', [point(0, 1), point(96, 0.125, -0.5)]);
    const mark = rig.calls('strip.level').length;
    rig.player.setLanes(RIG_OWNER, [edited]);
    const calls = rig.calls('strip.level', mark);
    expect(calls.slice(0, 2)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: at(6) },
      { call: 'setValueAtTime', value: valueAt(LEVEL, edited.points, 6), time: at(6) },
    ]);
    expect(calls.slice(2)).toEqual(
      [7, 8, 9, 10, 11].map((tick) => ({
        call: 'linearRampToValueAtTime',
        value: valueAt(LEVEL, edited.points, tick),
        time: times[tick],
      })),
    );
  });
});

describe('lanes off and gone', () => {
  it('gives the target back to its knob at now when a lane is turned off or deleted', () => {
    for (const next of [[{ ...FADE, on: false }], []]) {
      const rig = automationRig();
      rig.player.setLanes(RIG_OWNER, [FADE]);
      rig.run(12);
      rig.now = at(3);
      const mark = rig.calls('strip.level').length;
      rig.player.setLanes(RIG_OWNER, next);
      expect(rig.calls('strip.level', mark)).toEqual([
        { call: 'cancelScheduledValues', value: expect.any(Number), time: at(3) },
        { call: 'setValueAtTime', value: RIG_RESTING, time: at(3) },
      ]);
      expect(rig.handle('strip.level').engaged).toBe(false);
      const after = rig.calls('strip.level').length;
      rig.run(12);
      expect(rig.calls('strip.level', after)).toEqual([]);
    }
  });

  it("passes a sequencer lane by: it is the region gate's, never the resolver's (windsor#488)", () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [lane('seq.gate', [point(0, 0.25), point(96, 1)]), FADE]);
    rig.run(96);
    expect(rig.calls('seq.gate')).toEqual([]);
    expect(rig.handle('seq.gate').engaged).toBe(false);
    expect(rig.handle('strip.level').engaged).toBe(true);
  });

  it('forgets a removed part without touching its params', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    const mark = rig.calls('strip.level').length;
    rig.player.remove(RIG_OWNER);
    rig.run(24);
    rig.player.stop();
    expect(rig.calls('strip.level', mark)).toEqual([]);
  });

  it('stops hearing the transport once disposed', () => {
    const rig = automationRig();
    rig.player.setLanes(RIG_OWNER, [FADE]);
    const mark = rig.calls('strip.level').length;
    rig.player.dispose();
    rig.run(24);
    expect(rig.calls('strip.level', mark)).toEqual([]);
  });
});

describe('a resync after the targets moved (windsor#345)', () => {
  const knob = (param: FakeParam, resting: number) =>
    knobHandle({
      params: [param as unknown as AudioParam],
      write: sameValue,
      resting: () => resting,
    });

  it('gives back a handle no lane plays through any more, and holds the new one from now', () => {
    const rig = automationRig();
    const params = { a: new FakeParam(RIG_RESTING), b: new FakeParam(RIG_RESTING) };
    const handles = { a: knob(params.a, 0.1), b: knob(params.b, 0.2) };
    let on: 'a' | 'b' | null = 'a';
    const player = new AutomationPlayer({
      transport: rig.transport,
      now: () => rig.now,
      resolve: () => (on ? { handle: handles[on], row: LEVEL } : undefined),
      songTicks: RIG_SONG_TICKS,
      restTick: 0,
    });
    player.setLanes(RIG_OWNER, [FADE]);
    rig.run(12);
    rig.now = at(3);
    const marks = [params.a.automation.length, params.b.automation.length] as const;
    on = 'b';
    player.resync(RIG_OWNER);
    expect(params.a.automation.slice(marks[0])).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: at(3) },
      { call: 'setValueAtTime', value: 0.1, time: at(3) },
    ]);
    expect(handles.a.engaged).toBe(false);
    expect(params.b.automation.slice(marks[1], marks[1] + 2)).toEqual([
      { call: 'cancelScheduledValues', value: RIG_RESTING, time: at(3) },
      { call: 'setValueAtTime', value: valueAt(LEVEL, FADE.points, 3), time: at(3) },
    ]);
    // The ticks already issued past now are scheduled again, on the new handle only.
    expect(params.b.automation.length).toBeGreaterThan(marks[1] + 2);
    const quiet = params.a.automation.length;
    rig.run(12);
    expect(params.a.automation.length).toBe(quiet);
    // A target the graph no longer has: its handle is given back and nothing more is scheduled.
    rig.now = at(15);
    on = null;
    player.resync(RIG_OWNER);
    expect(params.b.automation.slice(-1)).toEqual([
      { call: 'setValueAtTime', value: 0.2, time: at(15) },
    ]);
    const done = params.b.automation.length;
    rig.run(12);
    expect(params.b.automation.length).toBe(done);
    player.dispose();
  });
});
