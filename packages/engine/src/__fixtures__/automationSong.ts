/**
 * A song with automation lanes of each kind (windsor#342, record
 * `2026-10-01-song-automation-lanes`): `FULL_DOCUMENT` with the hat part
 * carrying a Tape and an EQ on its strip and lanes on its strip, both inserts
 * and its voice. The lanes are already in their normalised form, on and off,
 * with steps (two points on one tick) and bends, so a test can compare a
 * round trip with them directly. Tape is unsplit, so its `wow` lane is on a
 * field the insert does not read at the moment, which the song keeps.
 */
import type { AutomationLane, AutomationTargetId } from '../automation/automationLane';
import { formatTargetId, voiceTargetId } from '../automation/automationTargets';
import { DEFAULT_EQ } from '../inserts/eqSpec';
import { DEFAULT_TAPE } from '../inserts/tapeSpec';
import type { ArrangementDocument, DocumentPart } from '../song/arrangementDocument';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { FULL_DOCUMENT, FULL_SLOT, FULL_STRIPS } from './fullArrangement';

/** The hat strip's inserts' ids. */
export const AUTOMATION_TAPE_ID = 'tape1';
export const AUTOMATION_EQ_ID = 'eq1';

const BAR = TICKS_PER_BAR;

/** The target id of an insert's field. */
const insertTarget = (insertId: string, field: string): AutomationTargetId =>
  formatTargetId({ kind: 'insert', insertId, field });

/** The hat part's lanes, one per kind of target and more, in normalised form. */
export const AUTOMATION_LANES: readonly AutomationLane[] = [
  {
    target: 'strip.level',
    on: true,
    points: [
      { tick: 0, value: 0.5, bend: 0.4 },
      { tick: 2 * BAR, value: 1, bend: 0 },
    ],
  },
  {
    target: 'strip.pan',
    on: false,
    points: [
      { tick: BAR, value: -0.5, bend: 0 },
      { tick: BAR, value: 0.5, bend: -0.3 },
      { tick: 3 * BAR, value: 0, bend: 0 },
    ],
  },
  {
    target: insertTarget(AUTOMATION_TAPE_ID, 'drive'),
    on: true,
    points: [
      { tick: 0, value: -6, bend: 0 },
      { tick: 4 * BAR, value: 18, bend: -1 },
    ],
  },
  {
    target: insertTarget(AUTOMATION_TAPE_ID, 'wow'),
    on: true,
    points: [{ tick: BAR / 2, value: 25, bend: 0 }],
  },
  {
    target: insertTarget(AUTOMATION_EQ_ID, 'bands.0.freq'),
    on: false,
    points: [
      { tick: 0, value: 80, bend: 1 },
      { tick: 2 * BAR, value: 2000, bend: 0 },
    ],
  },
  {
    target: voiceTargetId('filter.cutoff'),
    on: true,
    points: [
      { tick: 0, value: 200, bend: 0.6 },
      { tick: 1.5 * BAR, value: 8000, bend: -0.6 },
      { tick: 3 * BAR, value: 400, bend: 0 },
    ],
  },
  {
    target: voiceTargetId('ops.0.level'),
    on: true,
    points: [
      { tick: 0, value: 1, bend: 0 },
      { tick: 2 * BAR, value: 1, bend: 0 },
      { tick: 2 * BAR, value: 0.25, bend: 0 },
    ],
  },
];

/** The hat part with its inserts and lanes. */
export const AUTOMATION_PART: DocumentPart = {
  ...FULL_DOCUMENT.parts.find((part) => part.slot === FULL_SLOT.hat)!,
  strip: {
    ...FULL_STRIPS.hat,
    inserts: [
      { ...DEFAULT_TAPE, id: AUTOMATION_TAPE_ID },
      { ...DEFAULT_EQ, id: AUTOMATION_EQ_ID },
    ],
  },
  automation: AUTOMATION_LANES,
};

/** `FULL_DOCUMENT` with the hat part replaced by `AUTOMATION_PART`. */
export const AUTOMATION_DOCUMENT: ArrangementDocument = {
  ...FULL_DOCUMENT,
  parts: FULL_DOCUMENT.parts.map((part) => (part.slot === FULL_SLOT.hat ? AUTOMATION_PART : part)),
};
