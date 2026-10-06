/**
 * A group bus's own lanes on its folder track (windsor#616; record
 * `2026-10-05-group-automation-folder-tracks`), through the part's lane
 * rules: the picker offers the Mixer group's Level and Pan, then one group
 * per insert labelled as a part's chain is, and never a send, voice, macro
 * or sequencer row; a laned target is disabled; a new lane starts at the
 * group's own value; and the lanes go through the document, an insert's with
 * the insert.
 */
import { describe, expect, it } from 'vitest';
import {
  GROUP_LANES,
  GROUP_LANES_DOCUMENT,
  GROUP_LEVEL_LANE,
  GROUP_PHASER,
  LANE_GROUP,
  LANE_GROUP_ID,
  groupPhaserTarget,
} from '@windsor/engine/__fixtures__/groupAutomationSong';
import {
  automatableInsertFields,
  isGroupTarget,
  targetKind,
  type AutomationTargetId,
  type GroupSpec,
  type InsertSpec,
} from '@windsor/engine';
import { DocumentModel } from './documentModel';
import type { PickerGroup } from './songAutomationModel';
import {
  automationSignature,
  currentValue,
  laneActivity,
  laneTitle,
  pickerGroups,
} from './songAutomationModel';
import { ownerAutomationChange } from './songAutomationOwner';

const targets = (groups: readonly PickerGroup[]): AutomationTargetId[] =>
  groups.flatMap((g) => g.options.map((o) => o.target));

/** The Drums group with no lanes. */
const BARE: GroupSpec = { ...LANE_GROUP, automation: [] };

describe('the picker for a group', () => {
  it('offers Level and Pan, then one group per insert, and nothing else', () => {
    const groups = pickerGroups(BARE);
    expect(groups.map((g) => g.label)).toEqual(['Mixer', 'Insert · Phaser']);
    expect(groups[0]!.options.map((o) => [o.target, o.label])).toEqual([
      ['strip.level', 'Level'],
      ['strip.pan', 'Pan'],
    ]);
    const fields = automatableInsertFields(GROUP_PHASER).map((row) => row.label);
    expect(groups[1]!.options.map((o) => o.label)).toEqual(fields);
    expect(targets(groups).every((target) => isGroupTarget(target))).toBe(true);
    expect(targets(groups).some((t) => t.startsWith('strip.send'))).toBe(false);
    expect(targets(groups).some((t) => ['voice', 'seq'].includes(targetKind(t)))).toBe(false);
  });

  it('labels each insert as a part’s chain of the same kinds does', () => {
    const twice: GroupSpec = {
      ...BARE,
      inserts: [GROUP_PHASER, { ...GROUP_PHASER, id: 'gphase2' }],
    };
    const labels = pickerGroups(twice).map((g) => g.label);
    expect(labels).toEqual(['Mixer', 'Insert · Phaser 1', 'Insert · Phaser 2']);
  });

  it('disables the targets that already have a lane, and only those', () => {
    const disabled = pickerGroups(LANE_GROUP)
      .flatMap((g) => g.options)
      .filter((o) => o.disabled)
      .map((o) => o.target);
    expect(disabled.sort()).toEqual(GROUP_LANES.map((lane) => lane.target).sort());
    const none = pickerGroups(BARE).flatMap((g) => g.options);
    expect(none.some((o) => o.disabled)).toBe(false);
  });
});

describe('a group lane', () => {
  it('starts at the group’s own level, pan and insert field', () => {
    expect(currentValue(LANE_GROUP, undefined, 'strip.level')).toBe(LANE_GROUP.level);
    expect(currentValue({ ...LANE_GROUP, pan: -0.25 }, undefined, 'strip.pan')).toBe(-0.25);
    const rate = (GROUP_PHASER as InsertSpec & { rate: number }).rate;
    expect(currentValue(LANE_GROUP, undefined, groupPhaserTarget('rate'))).toBe(rate);
  });

  it('is named as a part’s: Level over Mixer, an insert field over its insert', () => {
    expect(laneTitle(LANE_GROUP, 'strip.level')).toEqual({
      name: 'Level',
      kindLine: 'Mixer',
      kind: 'strip',
    });
    const rate = laneTitle(LANE_GROUP, groupPhaserTarget('rate'));
    expect(rate.kindLine).toBe('Phaser');
    expect(rate.kind).toBe('insert');
    expect(laneActivity(LANE_GROUP, groupPhaserTarget('rate')).active).toBe(true);
  });

  it('goes through the document, and an insert’s lanes go with the insert', () => {
    const model = new DocumentModel(GROUP_LANES_DOCUMENT);
    const lanes = (): AutomationTargetId[] =>
      (model.doc.groups?.find((g) => g.id === LANE_GROUP_ID)?.automation ?? []).map(
        (l) => l.target,
      );
    model.merge(ownerAutomationChange(LANE_GROUP, [GROUP_LEVEL_LANE]));
    expect(lanes()).toEqual(['strip.level']);
    model.merge(ownerAutomationChange(LANE_GROUP, GROUP_LANES));
    expect(lanes()).toContain(groupPhaserTarget('rate'));
    model.merge({ groups: { [LANE_GROUP_ID]: { inserts: [] } } });
    expect(lanes()).toEqual(['strip.level', 'strip.pan']);
  });

  it('repaints on its lanes and its inserts, not on a knob', () => {
    expect(automationSignature(BARE, false)).toBeNull();
    const base = JSON.stringify(automationSignature(LANE_GROUP, true));
    const turned: GroupSpec = { ...LANE_GROUP, level: 0.3, inserts: [{ ...GROUP_PHASER }] };
    expect(JSON.stringify(automationSignature(turned, true))).toBe(base);
    const removed: GroupSpec = { ...LANE_GROUP, inserts: [] };
    expect(JSON.stringify(automationSignature(removed, true))).not.toBe(base);
  });
});
