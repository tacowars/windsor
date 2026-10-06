/**
 * A group's lanes on the live transport (windsor#614, record
 * `2026-10-05-group-automation-folder-tracks` decision 4): every
 * discontinuity the part lanes' tests pin (`audioSystemAutomationTransport.test.ts`)
 * holds a group's lane the same way: a seek and a start there, a stop, the
 * loop's jump back, a tempo change, and a song shortened then lengthened,
 * which refits the group's held lanes as the document's normaliser does.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { FULL_BARS } from '../__fixtures__/fullArrangement';
import { LANE_GROUP_ID } from '../__fixtures__/groupAutomationSong';
import { GROUP_FIRST, GROUP_TICK, groupLaneRig, groupLaneSong } from '../__fixtures__/groupLaneRig';
import { ENGINE_WORKLETS, installParamWorklet } from '../__fixtures__/insertParamRig';
import { valueAt } from '../automation/automationEvaluate';
import type { AutomationLane } from '../automation/automationLane';
import { requireCatalogRow } from '../automation/automationTargets';
import { PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { makeArrangement } from '../song/arrangementDocument';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const ID = LANE_GROUP_ID;
const LEVEL = requireCatalogRow('strip.level');
const FADE = lane('strip.level', [point(0, 0.25, 0.5), point(192, 1)]);
const held = (at: number, value: number) => [
  { call: 'cancelScheduledValues', value: expect.any(Number), time: at },
  { call: 'setValueAtTime', value, time: at },
];

const rig = (automation: readonly AutomationLane[], transport = {}) => {
  const song = groupLaneSong({ group: { automation } });
  return groupLaneRig({ ...song, transport: { ...song.transport, ...transport } });
};

describe("a group's lanes on the transport", () => {
  it('holds the seeked tick while stopped, and again when ▶ starts there', async () => {
    const r = await rig([FADE]);
    r.context.currentTime = 0.3;
    expect(r.sys.seekMusic(48)).toBe(true);
    expect(r.level().automation.slice(-2)).toEqual(held(0.3, valueAt(LEVEL, FADE.points, 48)));
    r.sys.startMusic();
    const mark = r.level().automation.length;
    r.play(0.32);
    expect(r.level().automation.slice(mark, mark + 2)).toEqual(
      held(0.3 + GROUP_FIRST, valueAt(LEVEL, FADE.points, 48)),
    );
  });

  it('holds where the playhead stood on ■', async () => {
    const r = await rig([FADE]);
    r.sys.startMusic();
    r.play(0.5);
    r.sys.stopMusic();
    const [cancel, set] = r.level().automation.slice(-2);
    expect(cancel).toMatchObject({ call: 'cancelScheduledValues', time: 0.5 });
    expect(set).toMatchObject({ call: 'setValueAtTime', time: 0.5 });
    expect(set!.value).toBeCloseTo(
      valueAt(LEVEL, FADE.points, (0.5 - GROUP_FIRST) / GROUP_TICK),
      12,
    );
  });

  it("holds the loop start's value at the loop's jump back", async () => {
    const r = await rig([FADE], { loop: { start: 0, end: 96, on: true } });
    r.sys.startMusic();
    r.play(96 * GROUP_TICK + 0.2);
    const jump = GROUP_FIRST + 96 * GROUP_TICK;
    const atJump = r.level().automation.filter((c) => Math.abs(c.time! - jump) < 1e-9);
    expect(atJump.map((c) => [c.call, c.value])).toEqual([
      ['cancelScheduledValues', expect.any(Number)],
      ['setValueAtTime', 0.25],
    ]);
  });

  it('holds from now on a tempo change, then plays on at the new tempo', async () => {
    const r = await rig([FADE]);
    r.sys.startMusic();
    r.play(0.5);
    const mark = r.level().automation.length;
    expect(r.sys.apply({ transport: { bpm: 120 } }).ok).toBe(true);
    const calls = r.level().automation.slice(mark);
    expect(calls[0]).toMatchObject({ call: 'cancelScheduledValues', time: 0.5 });
    expect(calls[1]!.value).toBeCloseTo(
      valueAt(LEVEL, FADE.points, (0.5 - GROUP_FIRST) / GROUP_TICK),
      12,
    );
    r.play(1);
    const times = r
      .level()
      .automation.filter((c) => c.call === 'linearRampToValueAtTime')
      .map((c) => c.time!);
    expect(times.at(-1)! - times.at(-2)!).toBeCloseTo(60 / 120 / PPQ, 9);
  });

  it("refits the held lanes on a song shortened then lengthened, as the document's", async () => {
    const cut = 3 * TICKS_PER_BAR;
    const ramp = lane('strip.level', [point(0, 0.1), point(FULL_BARS * TICKS_PER_BAR, 1)]);
    const r = await rig([ramp]);
    r.sys.startMusic();
    r.play(0.5);
    expect(r.sys.apply({ transport: { bars: 3 } }).ok).toBe(true);
    expect(r.sys.apply({ transport: { bars: FULL_BARS } }).ok).toBe(true);
    // The document the console holds: shortened, normalised, lengthened, normalised again.
    const doc: ArrangementDocument = groupLaneSong({ group: { automation: [ramp] } });
    const shortened = makeArrangement({ ...doc, transport: { ...doc.transport, bars: 3 } });
    const regrown = makeArrangement({
      ...shortened.document,
      transport: { ...shortened.document.transport, bars: FULL_BARS },
    }).document;
    const expected = regrown.groups![0]!.automation;
    expect(expected![0]!.points.at(-1)!.tick).toBe(cut);
    expect(r.sys.groupAutomationLanes(ID)).toEqual(expected);
    const end = valueAt(LEVEL, ramp.points, cut);
    r.play(GROUP_FIRST + (cut + 60) * GROUP_TICK);
    for (let tick = cut; tick < cut + 60; tick++) {
      expect(r.level().valueAt(GROUP_FIRST + tick * GROUP_TICK)).toBeCloseTo(end, 12);
    }
  });
});
