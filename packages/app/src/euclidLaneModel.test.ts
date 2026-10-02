/**
 * The Euclid card's lane writes (windsor#356, decision 5 and the acceptance
 * list): the accent toggle, the pitch value and its clamp, a lane's length
 * at 1 and 32, remove, add (and what the picker refuses), the accent
 * amounts, and a round trip of each through the document.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { EuclidRows, EuclideanSpec } from '@windsor/engine';
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  ARRANGEMENT_VERSION,
  EUCLID_LANE_STEPS_MAX,
  EUCLID_PITCH_LANE_MAX,
  STEP_MOD_LANES_MAX,
  VOICE_TARGET_PATHS,
  partAt,
  regionPattern,
} from '@windsor/engine';
import { partChange } from './context';
import { loadBuiltIns } from './builtInLibrary';
import { DocumentModel } from './documentModel';
import {
  addLaneRow,
  clampPitch,
  laneChoices,
  laneLength,
  laneValues,
  lanesOf,
  pitchFromDrag,
  removeLane,
  removesRow,
  resizeLane,
  setPitch,
  toggleAccent,
  withRows,
} from './euclidLaneModel';
import { patternCopy, regionPatternChange } from './partEdits';
import { EUCLID_ACCENT_KNOBS } from './sequencerKnobTables';

beforeAll(() => loadBuiltIns());

const ROWS: EuclidRows = {
  accentLane: [true, false, false, false, true, false, false],
  pitchLane: [0, 7, 0, -5, 12],
  modLanes: [{ param: 'filter.cutoff', values: [0.5, -0.25, 0, 0, 0, 0, 0, 0, 0, 0] }],
};

describe('the lanes a part has', () => {
  it('lists accent, pitch, then the sound lanes, each at its own length', () => {
    expect(lanesOf(ROWS)).toEqual([
      { kind: 'accent' },
      { kind: 'pitch' },
      { kind: 'sound', param: 'filter.cutoff' },
    ]);
    expect(lanesOf(ROWS).map((ref) => laneLength(ROWS, ref))).toEqual([7, 5, 10]);
    expect(lanesOf({})).toEqual([]);
  });

  it('reads an accent as 1 or 0', () => {
    expect(laneValues(ROWS, { kind: 'accent' })).toEqual([1, 0, 0, 0, 1, 0, 0]);
  });
});

describe('a lane edit', () => {
  it('toggles an accent step', () => {
    expect(toggleAccent(ROWS, 1)).toEqual({
      accentLane: [true, true, false, false, true, false, false],
    });
    expect(toggleAccent(ROWS, 0).accentLane).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('sets a pitch step whole and within ±24', () => {
    expect(setPitch(ROWS, 2, 3)).toEqual({ pitchLane: [0, 7, 3, -5, 12] });
    expect(setPitch(ROWS, 2, 30).pitchLane).toEqual([0, 7, EUCLID_PITCH_LANE_MAX, -5, 12]);
    expect(setPitch(ROWS, 2, -99).pitchLane).toEqual([0, 7, -EUCLID_PITCH_LANE_MAX, -5, 12]);
    expect(setPitch(ROWS, 2, 2.6).pitchLane).toEqual([0, 7, 3, -5, 12]);
    expect(clampPitch(-0.2)).toBe(0);
    expect(Object.is(clampPitch(-0.2), -0)).toBe(false);
  });

  it('drags a pitch one semitone per 6 px, up positive, clamped', () => {
    expect(pitchFromDrag(0, -30, 6)).toBe(5);
    expect(pitchFromDrag(7, 18, 6)).toBe(4);
    expect(pitchFromDrag(20, -600, 6)).toBe(EUCLID_PITCH_LANE_MAX);
  });

  it('lengthens and shortens a lane, padding with 0 and holding 1 and 32', () => {
    expect(resizeLane(ROWS, { kind: 'pitch' }, 6)).toEqual({ pitchLane: [0, 7, 0, -5, 12, 0] });
    expect(resizeLane(ROWS, { kind: 'accent' }, 3)).toEqual({ accentLane: [true, false, false] });
    expect(resizeLane(ROWS, { kind: 'pitch' }, 0).pitchLane).toEqual([0]);
    const long = resizeLane(ROWS, { kind: 'pitch' }, EUCLID_LANE_STEPS_MAX + 1).pitchLane;
    expect(long).toHaveLength(EUCLID_LANE_STEPS_MAX);
    const sound = resizeLane(ROWS, { kind: 'sound', param: 'filter.cutoff' }, 2);
    expect(sound).toEqual({ modLanes: [{ param: 'filter.cutoff', values: [0.5, -0.25] }] });
  });

  it('removes a lane: its row, or a sound lane from beside the others', () => {
    const removed = removeLane(ROWS, { kind: 'accent' });
    expect('accentLane' in removed && removed.accentLane === undefined).toBe(true);
    expect(removesRow(removed)).toBe(true);
    expect(removesRow(removeLane(ROWS, { kind: 'sound', param: 'filter.cutoff' }))).toBe(true);
    const two: EuclidRows = {
      modLanes: [...ROWS.modLanes!, { param: 'ops.0.level', values: [0.25] }],
    };
    const left = removeLane(two, { kind: 'sound', param: 'filter.cutoff' });
    expect(left).toEqual({ modLanes: [{ param: 'ops.0.level', values: [0.25] }] });
    expect(removesRow(left)).toBe(false);
  });

  it('writes the rows over a pattern and drops a removed one', () => {
    const pattern = { kind: 'euclidean', steps: 16, ...ROWS };
    const out = withRows(pattern, { accentLane: undefined, ratchets: [2] });
    expect(out).not.toHaveProperty('accentLane');
    expect(out).toMatchObject({ steps: 16, ratchets: [2], pitchLane: ROWS.pitchLane });
  });
});

describe('Add lane', () => {
  it('adds a lane min(steps, 32) long, every value 0', () => {
    expect(addLaneRow({}, 'accent', 16)).toEqual({ accentLane: new Array(16).fill(false) });
    expect(addLaneRow({}, 'pitch', 40)).toEqual({ pitchLane: new Array(32).fill(0) });
    expect(addLaneRow(ROWS, 'ops.0.level', 12)).toEqual({
      modLanes: [...ROWS.modLanes!, { param: 'ops.0.level', values: new Array(12).fill(0) }],
    });
  });

  it('offers Accent and Pitch once each', () => {
    const open = laneChoices({});
    expect(open.find((c) => c.value === 'accent')?.disabled).toBe(false);
    expect(open.find((c) => c.value === 'pitch')?.disabled).toBe(false);
    const taken = laneChoices(ROWS);
    expect(taken.find((c) => c.value === 'accent')?.disabled).toBe(true);
    expect(taken.find((c) => c.value === 'pitch')?.disabled).toBe(true);
    expect(addLaneRow(ROWS, 'accent', 16)).toBeNull();
    expect(addLaneRow(ROWS, 'pitch', 16)).toBeNull();
  });

  it('offers each sound parameter once, and none at four sound lanes', () => {
    expect(laneChoices(ROWS).find((c) => c.value === 'filter.cutoff')?.disabled).toBe(true);
    expect(addLaneRow(ROWS, 'filter.cutoff', 16)).toBeNull();
    const full: EuclidRows = {
      modLanes: VOICE_TARGET_PATHS.slice(0, STEP_MOD_LANES_MAX).map((param) => ({
        param,
        values: [0],
      })),
    };
    const sounds = laneChoices(full).filter((c) => c.value !== 'accent' && c.value !== 'pitch');
    expect(sounds).toHaveLength(VOICE_TARGET_PATHS.length);
    expect(sounds.every((c) => c.disabled)).toBe(true);
    // The accent and pitch lanes do not count against the four.
    expect(addLaneRow(full, 'accent', 16)).not.toBeNull();
    expect(addLaneRow(full, VOICE_TARGET_PATHS[STEP_MOD_LANES_MAX]!, 16)).toBeNull();
    expect(addLaneRow(ROWS, 'nonsense', 16)).toBeNull();
  });
});

describe('the accent amounts', () => {
  it('Acc vel and Acc mod write accentVelocity and accentMod, at the engine defaults', () => {
    expect(EUCLID_ACCENT_KNOBS.map((k) => [k.label, k.f, k.o.def])).toEqual([
      ['Acc vel', 'accentVelocity', ACCENT_VELOCITY_DEFAULT],
      ['Acc mod', 'accentMod', ACCENT_MOD_DEFAULT],
    ]);
  });
});

describe('a lane edit in the document', () => {
  const SONG = {
    version: ARRANGEMENT_VERSION,
    transport: { bpm: 120, bars: 1 },
    parts: [
      {
        slot: 0,
        name: 'toms',
        preset: 'tr808-tom-mid',
        regions: [{ start: 0, duration: 384 }],
        sequencer: { kind: 'euclidean', seed: 0 },
      },
    ],
  };
  const spec = (model: DocumentModel): EuclideanSpec =>
    regionPattern(partAt(model.doc, 0)!, 0) as EuclideanSpec;
  const write = (model: DocumentModel, fields: Record<string, unknown>): void => {
    model.merge(regionPatternChange(model.doc, 0, 0, fields));
  };

  it('adds the rows to a region with none, removes one, and round-trips', () => {
    const model = new DocumentModel(SONG);
    write(model, addLaneRow(spec(model), 'accent', spec(model).steps)!);
    write(model, toggleAccent(spec(model), 3));
    write(model, addLaneRow(spec(model), 'pitch', 5)!);
    write(model, setPitch(spec(model), 1, 7));
    write(model, { accentVelocity: 0.5, accentMod: 0.25 });
    expect(spec(model).accentLane?.[3]).toBe(true);
    expect(spec(model).pitchLane).toEqual([0, 7, 0, 0, 0]);
    expect(spec(model)).toMatchObject({ accentVelocity: 0.5, accentMod: 0.25 });
    // A removal writes the region's pattern whole, as the card's writeRows does.
    const part = partAt(model.doc, 0)!;
    const pattern = withRows(patternCopy(part, 0), removeLane(spec(model), { kind: 'accent' }));
    model.merge(partChange(0, { regions: [{ ...part.regions[0], pattern }] }));
    expect(spec(model).accentLane).toBeUndefined();
    expect(spec(model).pitchLane).toEqual([0, 7, 0, 0, 0]);
    expect(model.corrections).toEqual([]);
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc).toEqual(model.doc);
  });
});
