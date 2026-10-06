/**
 * A lane owner on the Song view (windsor#616): a part or a group bus, told
 * apart, its chain and level read from the right place, its lanes written
 * by the right partial, found again in the document, and every group lane
 * edit one undo step that undo and redo restore, as a part's are. Removing
 * the group takes its lanes with it, and one undo brings both back.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { AUTOMATION_PART, AUTOMATION_TAPE_ID } from '@windsor/engine/__fixtures__/automationSong';
import {
  GROUP_LANES_DOCUMENT,
  GROUP_LEVEL_LANE,
  GROUP_PHASER,
  LANE_GROUP,
  LANE_GROUP_ID,
  groupPhaserTarget,
} from '@windsor/engine/__fixtures__/groupAutomationSong';
import type { AutomationLane, ArrangementDocument } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { openGestureConsole } from './__fixtures__/gestureConsole';
import { settleGestures, withGesture } from './gestureHooks';
import { groupAt, removeGroup } from './groupModel';
import { withPoints } from './songAutomationEdit';
import { lanesOf, newLane, withLane, withoutLane } from './songAutomationModel';
import {
  isGroupLaneOwner,
  liveOwner,
  ownerAutomationChange,
  ownerInserts,
  ownerKey,
  ownerLanes,
  ownerStrip,
} from './songAutomationOwner';

afterEach(() => settleGestures());

const groupLanes = (doc: ArrangementDocument): readonly AutomationLane[] =>
  groupAt(doc, LANE_GROUP_ID)?.automation ?? [];

describe('a lane owner', () => {
  it('tells a group from a part', () => {
    expect(isGroupLaneOwner(LANE_GROUP)).toBe(true);
    expect(isGroupLaneOwner(AUTOMATION_PART)).toBe(false);
  });

  it('reads a group’s chain and its own level and pan, and a part’s from its strip', () => {
    expect(ownerInserts(LANE_GROUP)).toEqual([GROUP_PHASER]);
    expect(ownerInserts(AUTOMATION_PART).map((spec) => spec.id)).toContain(AUTOMATION_TAPE_ID);
    expect(ownerStrip(LANE_GROUP)).toBe(LANE_GROUP);
    expect(ownerStrip(AUTOMATION_PART)).toBe(AUTOMATION_PART.strip);
    const { id, name, level, pan, inserts } = LANE_GROUP;
    expect(ownerLanes({ id, name, level, pan, inserts })).toEqual([]);
  });

  it('keys a part by its slot, as before, and a group by a key no slot is', () => {
    expect(ownerKey(AUTOMATION_PART)).toBe(String(AUTOMATION_PART.slot));
    expect(ownerKey(LANE_GROUP)).toBe(`group:${LANE_GROUP_ID}`);
  });

  it('writes a group’s lanes under its id, and a part’s under its slot', () => {
    expect(ownerAutomationChange(LANE_GROUP, [GROUP_LEVEL_LANE])).toEqual({
      groups: { [LANE_GROUP_ID]: { automation: [GROUP_LEVEL_LANE] } },
    });
    expect(ownerAutomationChange(AUTOMATION_PART, [])).toEqual({
      parts: { [AUTOMATION_PART.slot]: { automation: [] } },
    });
  });

  it('finds the owner again in the document, or keeps the copy when it is gone', () => {
    const stale = { ...LANE_GROUP, automation: [] };
    expect(liveOwner(GROUP_LANES_DOCUMENT, stale)).toEqual(LANE_GROUP);
    expect(liveOwner({ ...GROUP_LANES_DOCUMENT, groups: [] }, stale)).toBe(stale);
    const part = GROUP_LANES_DOCUMENT.parts[0]!;
    expect(liveOwner(GROUP_LANES_DOCUMENT, { ...part, automation: [] })).toBe(part);
  });
});

describe('a group lane’s edits, undone and redone (windsor#616)', () => {
  /** Commit `lanes` as the group's, one named step, as `songAutomationLane.ts` does. */
  const commit = (
    ctx: ReturnType<typeof openGestureConsole>,
    label: string,
    lanes: AutomationLane[],
  ): void => {
    const group = groupAt(ctx.model.doc, LANE_GROUP_ID)!;
    withGesture(label, () => ctx.change(ownerAutomationChange(group, lanes)));
    settleGestures();
  };

  it('restores the lanes before an add, a point edit and a delete, and redoes each', () => {
    const ctx = openGestureConsole(GROUP_LANES_DOCUMENT);
    const before = groupLanes(ctx.model.doc);
    const songTicks = ctx.model.doc.transport.bars * TICKS_PER_BAR;
    const added = newLane(groupPhaserTarget('depth'), 0.5, songTicks);
    const steps: [string, (lanes: readonly AutomationLane[]) => AutomationLane[]][] = [
      ['Add Depth lane', (lanes) => withLane(lanes, added)],
      [
        'Move point',
        (lanes) =>
          withPoints(lanes, 'strip.level', [
            { tick: 0, value: 0.25, bend: 0 },
            { tick: TICKS_PER_BAR, value: 1, bend: 0 },
          ]),
      ],
      ['Delete Pan lane', (lanes) => withoutLane(lanes, 'strip.pan')],
    ];
    const history = [before];
    for (const [label, edit] of steps) {
      commit(ctx, label, edit(groupLanes(ctx.model.doc)));
      history.push(groupLanes(ctx.model.doc));
    }
    expect(history[1]!.map((l) => l.target)).toContain(added.target);
    expect(history[2]!.find((l) => l.target === 'strip.level')?.points[0]?.value).toBe(0.25);
    expect(history[3]!.map((l) => l.target)).not.toContain('strip.pan');
    for (const i of [2, 1, 0]) {
      expect(ctx.undo()).toBe(true);
      expect(groupLanes(ctx.model.doc)).toEqual(history[i]);
    }
    for (const i of [1, 2, 3]) {
      expect(ctx.redo()).toBe(true);
      expect(groupLanes(ctx.model.doc)).toEqual(history[i]);
    }
  });

  it('takes the lanes away with the group, and one undo brings both back', () => {
    const ctx = openGestureConsole(GROUP_LANES_DOCUMENT);
    const before = groupLanes(ctx.model.doc);
    expect(before.length).toBeGreaterThan(0);
    expect(removeGroup(ctx, LANE_GROUP_ID)).toBe(true);
    settleGestures();
    expect(groupAt(ctx.model.doc, LANE_GROUP_ID)).toBeUndefined();
    expect(ctx.undo()).toBe(true);
    expect(groupLanes(ctx.model.doc)).toEqual(before);
    expect(lanesOf(groupAt(ctx.model.doc, LANE_GROUP_ID)!)).toEqual(before);
  });
});
