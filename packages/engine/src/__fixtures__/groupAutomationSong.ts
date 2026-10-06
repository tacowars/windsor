/**
 * A song with a group that carries automation lanes (windsor#614, record
 * `2026-10-05-group-automation-folder-tracks`): `AUTOMATION_DOCUMENT` (the hat
 * with its own inserts and lanes) with the kick and the hat routed into a
 * Drums group, whose level, pan and Phaser rate are automated, the song's
 * send buses spelled out, and the kick's figure captured. The lanes are in
 * their normalised form, on and off, with a step, a bend, a one-point lane
 * and a point on the song's last tick, so a test can compare a round trip
 * with them directly.
 */
import type { AutomationLane, AutomationTargetId } from '../automation/automationLane';
import { formatTargetId } from '../automation/automationTargets';
import type { InsertSpec } from '../inserts/insertRegistry';
import { DEFAULT_PHASER } from '../inserts/phaserSpec';
import type { GroupSpec } from '../mixer/mix';
import { RETURNS } from '../mixer/mix';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import type { ArrangementDocument, DocumentPart } from '../song/arrangementDocument';
import { AUTOMATION_DOCUMENT } from './automationSong';
import { FULL_SLOT, FULL_SONG_TICKS } from './fullArrangement';

const BAR = TICKS_PER_BAR;

/** The Drums group's id, and its Phaser's insert id. */
export const LANE_GROUP_ID = 4;
export const GROUP_PHASER_ID = 'gphase1';

/** The Drums group's Phaser. */
export const GROUP_PHASER = { ...DEFAULT_PHASER, id: GROUP_PHASER_ID } as InsertSpec;

/** The target id of the group Phaser's `field`. */
export const groupPhaserTarget = (field: string): AutomationTargetId =>
  formatTargetId({ kind: 'insert', insertId: GROUP_PHASER_ID, field });

/** The Drums group's level lane: a bent rise over two bars, then a hold. */
export const GROUP_LEVEL_LANE: AutomationLane = {
  target: 'strip.level',
  on: true,
  points: [
    { tick: 0, value: 0.5, bend: 0.3 },
    { tick: 2 * BAR, value: 1.2, bend: 0 },
  ],
};

/** The Drums group's lanes, one per kind of group target and more. */
export const GROUP_LANES: readonly AutomationLane[] = [
  GROUP_LEVEL_LANE,
  {
    target: 'strip.pan',
    on: true,
    points: [
      { tick: BAR, value: -0.5, bend: 0 },
      { tick: BAR, value: 0.5, bend: -0.2 },
      { tick: 3 * BAR, value: 0, bend: 0 },
    ],
  },
  {
    // From the first tick to the song's last.
    target: groupPhaserTarget('rate'),
    on: true,
    points: [
      { tick: 0, value: 0.2, bend: 0 },
      { tick: FULL_SONG_TICKS, value: 4, bend: 0 },
    ],
  },
  { target: groupPhaserTarget('mix'), on: false, points: [{ tick: BAR, value: 0.8, bend: 0 }] },
];

/** The Drums group with its Phaser and its lanes. */
export const LANE_GROUP: GroupSpec = {
  id: LANE_GROUP_ID,
  name: 'Drums',
  level: 0.8,
  pan: 0,
  inserts: [GROUP_PHASER],
  automation: GROUP_LANES,
};

/** The kick's figure, captured from what it played. */
export const CAPTURED_KICK = [true, false, false, true, false, false, true, false].concat(
  Array.from({ length: 8 }, (_, i) => i % 4 === 0),
);

const intoDrums = (part: DocumentPart): DocumentPart => {
  const grouped = { ...part, strip: { ...part.strip, output: { group: LANE_GROUP_ID } } };
  if (part.slot !== FULL_SLOT.kick || part.sequencer.kind !== 'euclidean') return grouped;
  return { ...grouped, sequencer: { ...part.sequencer, pattern: CAPTURED_KICK } };
};

/** `AUTOMATION_DOCUMENT` with the kick and the hat in Drums, the send buses and the group's lanes. */
export const GROUP_LANES_DOCUMENT: ArrangementDocument = {
  ...AUTOMATION_DOCUMENT,
  parts: AUTOMATION_DOCUMENT.parts.map((part) =>
    part.slot === FULL_SLOT.kick || part.slot === FULL_SLOT.hat ? intoDrums(part) : part,
  ),
  returns: RETURNS,
  groups: [LANE_GROUP],
};
