/**
 * A group's lanes on the live engine (windsor#614, record
 * `2026-10-05-group-automation-folder-tracks` decisions 4–7): built from the
 * document and held where the transport rests, played onto the group bus's
 * fader, pan and inserts beside its members' own lanes, and edited live by a
 * partial as a part's lanes are: replaced, added with a group, forgotten
 * with one, pruned with an insert and re-attached after a re-wire. Routing a
 * part in or out touches none of them.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { FULL_SLOT } from '../__fixtures__/fullArrangement';
import {
  GROUP_PHASER,
  LANE_GROUP_ID,
  groupPhaserTarget,
} from '../__fixtures__/groupAutomationSong';
import {
  GROUP_FIRST,
  GROUP_TICK,
  RIG_GROUP,
  groupLaneRig,
  groupLaneSong,
} from '../__fixtures__/groupLaneRig';
import { ENGINE_WORKLETS, installParamWorklet } from '../__fixtures__/insertParamRig';
import { valueAt } from '../automation/automationEvaluate';
import { insertTargetRow, requireCatalogRow } from '../automation/automationTargets';
import { DEFAULT_DELAY } from '../inserts/delaySpec';
import type { InsertSpec } from '../inserts/insertRegistry';
import { INSERT_FADE_SECONDS } from '../inserts/insertConstants';
import type { DocumentPartial } from '../song/arrangementDocument';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const { kick, hat } = FULL_SLOT;
const ID = LANE_GROUP_ID;
const LEVEL = requireCatalogRow('strip.level');
const RATE_ROW = insertTargetRow('phaser', 'rate')!;
const time = (tick: number): number => GROUP_FIRST + tick * GROUP_TICK;

/** The group fades from 0.4 up to unity over two bars; the hat's own fader dips. */
const GROUP_FADE = lane('strip.level', [point(0, 0.4, 0.3), point(192, 1)]);
const HAT_DIP = lane('strip.level', [point(0, 1), point(192, 0.2)]);
const RATE = lane(groupPhaserTarget('rate'), [point(0, 0.2), point(384, 4)]);
const PAN = lane('strip.pan', [point(0, -1), point(96, 1)]);
const DELAY = { ...DEFAULT_DELAY, id: 'gdelay1' } as InsertSpec;

const groups = (entry: unknown): DocumentPartial =>
  ({ groups: { [ID]: entry } }) as unknown as DocumentPartial;
const held = (at: number, value: number) => [
  { call: 'cancelScheduledValues', value: expect.any(Number), time: at },
  { call: 'setValueAtTime', value, time: at },
];

describe('group lanes from the document', () => {
  it("holds the group's level where the transport rests, and its member's own lane apart", async () => {
    const r = await groupLaneRig(
      groupLaneSong({ group: { automation: [GROUP_FADE] }, hatLanes: [HAT_DIP] }),
    );
    expect(r.level().automation).toEqual(held(0, 0.4));
    expect(r.partLevel(hat).automation).toEqual(held(0, 1));
    r.sys.startMusic();
    r.play(1);
    for (let tick = 1; tick < 30; tick++) {
      expect(r.level().valueAt(time(tick))).toBeCloseTo(
        valueAt(LEVEL, GROUP_FADE.points, tick),
        12,
      );
      expect(r.partLevel(hat).valueAt(time(tick))).toBeCloseTo(
        valueAt(LEVEL, HAT_DIP.points, tick),
        12,
      );
    }
    expect(r.sys.groupAutomationLanes(ID)).toEqual([GROUP_FADE]);
    expect(r.sys.automationLanes(hat)).toEqual([HAT_DIP]);
  });

  it("plays an insert lane on the group's own stage, and a pan lane on its rotation", async () => {
    const r = await groupLaneRig(groupLaneSong({ group: { automation: [RATE, PAN] } }));
    r.sys.startMusic();
    r.play(1);
    const rate = r.insertParam('phaser', 'rate');
    for (let tick = 1; tick < 30; tick++) {
      expect(rate.valueAt(time(tick))).toBeCloseTo(valueAt(RATE_ROW, RATE.points, tick), 9);
    }
    expect(r.bus().automation('pan')!.engaged).toBe(true);
  });

  it('plays the lanes of a group with no members onto its silent bus', async () => {
    const r = await groupLaneRig(
      groupLaneSong({ group: { automation: [GROUP_FADE] }, members: [] }),
    );
    r.sys.startMusic();
    r.play(0.5);
    expect(r.level().automation.slice(0, 2)).toEqual(held(0, 0.4));
    for (let tick = 1; tick < 15; tick++) {
      expect(r.level().valueAt(time(tick))).toBeCloseTo(
        valueAt(LEVEL, GROUP_FADE.points, tick),
        12,
      );
    }
  });

  it('schedules nothing on a group without lanes, and a knob lands as before', async () => {
    const r = await groupLaneRig(groupLaneSong());
    r.sys.startMusic();
    r.play(0.5);
    expect(r.level().automation).toEqual([]);
    expect(r.sys.apply(groups({ level: 0.5 })).ok).toBe(true);
    expect(r.level().value).toBe(0.5);
  });
});

describe('group lanes from a partial', () => {
  it("replaces the group's lanes, unreported, and a knob turn no longer fights them", async () => {
    const r = await groupLaneRig(groupLaneSong());
    r.context.currentTime = 0.2;
    expect(r.sys.apply(groups({ automation: [GROUP_FADE] }))).toEqual({ ok: true, ignored: [] });
    expect(r.level().automation.slice(-2)).toEqual(held(0.2, 0.4));
    expect(r.sys.apply(groups({ level: 0.9 }))).toEqual({ ok: true, ignored: [] });
    expect(r.level().value).toBe(0.4);
    expect(r.bus().spec.level).toBe(0.9);
    r.sys.apply(groups({ automation: [] }));
    expect(r.level().automation.at(-1)).toEqual({ call: 'setValueAtTime', value: 0.9, time: 0.2 });
    expect(r.sys.groupAutomationLanes(ID)).toEqual([]);
  });

  it('holds the lanes of a group added whole, and drops a lane on a target it lacks', async () => {
    const r = await groupLaneRig(groupLaneSong({ members: [] }));
    const added = {
      ...RIG_GROUP,
      id: 6,
      automation: [GROUP_FADE, lane('strip.send.a', [point(0, 1)])],
    };
    expect(r.sys.apply({ groups: { 6: added } })).toEqual({ ok: true, ignored: [] });
    expect(r.sys.groupAutomationLanes(6)).toEqual([GROUP_FADE]);
    expect(r.sys.groupBus(6)!.automation('level')!.engaged).toBe(true);
  });

  it("forgets a removed group's lanes, and leaves the parts' lanes alone", async () => {
    const r = await groupLaneRig(
      groupLaneSong({ group: { automation: [GROUP_FADE] }, hatLanes: [HAT_DIP] }),
    );
    expect(r.sys.apply(groups(null)).ok).toBe(true);
    expect(r.sys.groupAutomationLanes(ID)).toEqual([]);
    expect(r.sys.automationLanes(hat)).toEqual([HAT_DIP]);
    // Built again at the same id, it starts with none.
    expect(r.sys.apply(groups({ ...RIG_GROUP })).ok).toBe(true);
    expect(r.sys.groupAutomationLanes(ID)).toEqual([]);
    expect(r.level().automation).toEqual([]);
  });

  it("leaves the group's lanes alone when a part is routed out and back in", async () => {
    const r = await groupLaneRig(groupLaneSong({ group: { automation: [GROUP_FADE, RATE] } }));
    r.sys.startMusic();
    r.play(0.3);
    const marks = [r.level().automation.length, r.insertParam('phaser', 'rate').automation.length];
    const route = (output: unknown) =>
      r.sys.apply({ parts: { [kick]: { strip: { output } } } } as never);
    expect(route('master').ok).toBe(true);
    expect(route({ group: ID }).ok).toBe(true);
    expect(r.level().automation.length).toBe(marks[0]);
    expect(r.insertParam('phaser', 'rate').automation.length).toBe(marks[1]);
    expect(r.sys.groupAutomationLanes(ID)).toEqual([GROUP_FADE, RATE]);
  });
});

describe('group insert lanes through an insert edit', () => {
  it('drops the lane with its insert, and an undo brings both back to play on the new stage', async () => {
    const r = await groupLaneRig(groupLaneSong({ group: { automation: [GROUP_FADE, RATE] } }));
    r.sys.startMusic();
    r.play(0.3);
    expect(r.sys.apply(groups({ inserts: [] })).ok).toBe(true);
    expect(r.sys.groupAutomationLanes(ID)).toEqual([GROUP_FADE]);
    r.settle(0.3 + INSERT_FADE_SECONDS);
    expect(
      r.sys.apply(groups({ inserts: [GROUP_PHASER], automation: [GROUP_FADE, RATE] })).ok,
    ).toBe(true);
    expect(r.sys.groupAutomationLanes(ID)).toEqual([GROUP_FADE, RATE]);
    const landed = 0.4 + INSERT_FADE_SECONDS;
    r.settle(landed);
    const rate = r.insertParam('phaser', 'rate');
    const tick = (landed - GROUP_FIRST) / GROUP_TICK;
    expect(rate.automation.slice(0, 2)).toEqual(held(landed, expect.any(Number)));
    expect(rate.automation[1]!.value).toBeCloseTo(valueAt(RATE_ROW, RATE.points, tick), 6);
  });

  it('re-attaches the lanes that remain on a re-wire, once its fade lands', async () => {
    const r = await groupLaneRig(groupLaneSong({ group: { automation: [RATE] } }));
    r.sys.startMusic();
    r.play(0.3);
    const before = r.insertParam('phaser', 'rate');
    expect(r.sys.apply(groups({ inserts: [DELAY, GROUP_PHASER] })).ok).toBe(true);
    expect(r.sys.groupAutomationLanes(ID)).toEqual([RATE]);
    r.settle(0.35);
    const after = r.insertParam('phaser', 'rate');
    expect(after).not.toBe(before);
    expect(after.automation.slice(0, 2).map((c) => [c.call, c.time])).toEqual([
      ['cancelScheduledValues', 0.35],
      ['setValueAtTime', 0.35],
    ]);
  });
});
