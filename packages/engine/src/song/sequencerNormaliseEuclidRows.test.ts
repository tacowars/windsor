/**
 * A Euclid part's ratchet row and drawn lanes through the document
 * normaliser (windsor#355): absent stays absent and silent, every field
 * round-trips on a part and on a region's pattern, and each fix is
 * reported: an over-long, empty or junk lane, a value out of range, a
 * fractional semitone, a ratchet row of the wrong length, an unknown or
 * repeated parameter and a fifth mod lane.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from './arrangementFields';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ARRANGEMENT_VERSION, EUCLID_LANE_STEPS_MAX } from '../audioConstants';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { makePatch } from '../patch/patch';
import { STEP_MOD_LANES_MAX } from '../sequencing/stepModLanes';
import { VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';
import { normaliseSequencer } from './sequencerNormalise';

const PATH = 'parts[0].sequencer';
const BASE = { kind: 'euclidean', seed: 0, steps: 4, divisor: 6, note: 36 };

function normalise(extra: Record<string, unknown>): {
  spec: Record<string, unknown>;
  corrections: string[];
} {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ ...BASE, ...extra }, PATH, n);
  return { spec: spec as unknown as Record<string, unknown>, corrections: n.corrections };
}

const ROWS = {
  ratchets: [1, 2, 3, 4],
  accentVelocity: 0.35,
  accentMod: 0.5,
  accentLane: [true, false, false, true, false, false, true],
  pitchLane: [0, 12, -5, 24, -24],
  modLanes: [
    { param: 'filter.cutoff', values: [0.5, 0, -0.5, 0, 1] },
    { param: 'ops.0.width', values: Array.from({ length: 10 }, (_, i) => i / 10) },
  ],
};

describe('Euclid rows through the normaliser (windsor#355)', () => {
  it('absent stays absent, with nothing to report', () => {
    const { spec, corrections } = normalise({});
    expect(corrections).toEqual([]);
    for (const key of Object.keys(ROWS)) expect(spec).not.toHaveProperty(key);
  });

  it('keeps well-formed rows exactly', () => {
    const { spec, corrections } = normalise(ROWS);
    expect(corrections).toEqual([]);
    expect(spec).toMatchObject(ROWS);
  });

  it('fits the ratchet row to the steps, each a whole 1–4', () => {
    expect(normalise({ ratchets: [2, 0, 2.6] })).toMatchObject({
      spec: { ratchets: [2, 1, 3, 1] },
      corrections: [
        `${PATH}.ratchets: 3 ratchets for 4 steps — resized`,
        `${PATH}.ratchets[1]: clamped 0 to 1`,
        `${PATH}.ratchets[2]: rounded 2.6 to 3`,
      ],
    });
    expect(normalise({ ratchets: [1, 5, 1, 1, 4, 4] })).toMatchObject({
      spec: { ratchets: [1, 4, 1, 1] },
      corrections: [
        `${PATH}.ratchets: 6 ratchets for 4 steps — resized`,
        `${PATH}.ratchets[1]: clamped 5 to 4`,
      ],
    });
    const junk = normalise({ ratchets: 'fast' });
    expect(junk.spec).not.toHaveProperty('ratchets');
    expect(junk.corrections).toEqual([
      `${PATH}.ratchets: "fast" is not a list of ratchets — every step a single hit`,
    ]);
  });

  it('clamps the accent amounts and lane values, and rounds a fractional semitone', () => {
    const { spec, corrections } = normalise({
      accentVelocity: 1.5,
      accentMod: -1,
      accentLane: [true, 1],
      pitchLane: [2.4, 30, -31],
      modLanes: [{ param: 'filter.cutoff', values: [2, -0.5] }],
    });
    expect(spec).toMatchObject({
      accentVelocity: 1,
      accentMod: 0,
      accentLane: [true, false],
      pitchLane: [2, 24, -24],
      modLanes: [{ param: 'filter.cutoff', values: [1, -0.5] }],
    });
    expect(corrections).toEqual([
      `${PATH}.accentVelocity: clamped 1.5 to 1`,
      `${PATH}.accentMod: clamped -1 to 0`,
      `${PATH}.accentLane[1]: 1 is not a boolean — using false`,
      `${PATH}.pitchLane[0]: rounded 2.4 to 2`,
      `${PATH}.pitchLane[1]: clamped 30 to 24`,
      `${PATH}.pitchLane[2]: clamped -31 to -24`,
      `${PATH}.modLanes[0].values[0]: clamped 2 to 1`,
    ]);
  });

  it(`trims a lane past ${EUCLID_LANE_STEPS_MAX} steps and drops an empty or junk one`, () => {
    const long = Array.from({ length: EUCLID_LANE_STEPS_MAX + 3 }, (_, i) => i % 2 === 0);
    const { spec, corrections } = normalise({
      accentLane: long,
      pitchLane: [],
      modLanes: [
        { param: 'filter.cutoff', values: [] },
        { param: 'ops.1.width', values: 'up' },
        { param: 'ops.2.width', values: Array(40).fill(0.25) },
      ],
    });
    expect(spec.accentLane).toEqual(long.slice(0, EUCLID_LANE_STEPS_MAX));
    expect(spec).not.toHaveProperty('pitchLane');
    expect(spec.modLanes).toEqual([
      { param: 'ops.2.width', values: Array(EUCLID_LANE_STEPS_MAX).fill(0.25) },
    ]);
    expect(corrections).toEqual([
      `${PATH}.accentLane: ${long.length} steps trimmed to ${EUCLID_LANE_STEPS_MAX}`,
      `${PATH}.pitchLane: [] is not a lane of 1–${EUCLID_LANE_STEPS_MAX} steps — dropped`,
      `${PATH}.modLanes[0].values: [] is not a lane of 1–${EUCLID_LANE_STEPS_MAX} steps — dropped`,
      `${PATH}.modLanes[1].values: "up" is not a lane of 1–${EUCLID_LANE_STEPS_MAX} steps — dropped`,
      `${PATH}.modLanes[2].values: 40 steps trimmed to ${EUCLID_LANE_STEPS_MAX}`,
    ]);
  });

  it('drops an unknown or repeated parameter and a fifth mod lane, each reported', () => {
    const fifth = VOICE_TARGET_PATHS.slice(0, STEP_MOD_LANES_MAX + 1).map((param) => ({
      param,
      values: [0.5],
    }));
    const { spec, corrections } = normalise({
      modLanes: [
        { param: 'volume', values: [1] },
        fifth[0],
        { ...fifth[0], values: [1] },
        ...fifth.slice(1),
      ],
    });
    expect(spec.modLanes).toEqual(fifth.slice(0, STEP_MOD_LANES_MAX));
    expect(corrections).toEqual([
      `${PATH}.modLanes[0]: "volume" is not a parameter a lane can modulate — lane dropped`,
      `${PATH}.modLanes[2]: ${fifth[0]!.param} already has a lane — lane dropped`,
      `${PATH}.modLanes[${STEP_MOD_LANES_MAX + 2}]: more than ${STEP_MOD_LANES_MAX} lanes — lane dropped`,
    ]);
  });
});

/** A one-part Euclid song carrying `rows` on its sequencer and on its second region's pattern. */
function song(rows: Record<string, unknown>): Record<string, unknown> {
  const pattern = { ...BASE, ...rows, pitchLane: [7] };
  delete (pattern as Record<string, unknown>).seed;
  return {
    version: ARRANGEMENT_VERSION,
    transport: { bpm: 120, bars: 2 },
    harmony: { root: 0, scale: 'naturalMinor' },
    patches: { kick: makePatch({ name: 'kick' }) },
    parts: [
      {
        slot: 0,
        name: 'kick',
        preset: 'kick',
        velocity: 0.7,
        regions: [
          { start: 0, duration: TICKS_PER_BAR },
          { start: TICKS_PER_BAR, duration: TICKS_PER_BAR, pattern },
        ],
        sequencer: { ...BASE, ...rows },
      },
    ],
  };
}

describe('a song with Euclid rows round trips (windsor#355)', () => {
  it('keeps every field on a part and on a region’s pattern through export and import', () => {
    const first = makeArrangement(song(ROWS));
    expect(first.corrections).toEqual([]);
    expect(isShippable(first)).toBe(true);
    const part = first.document.parts[0]!;
    expect(part.sequencer).toMatchObject(ROWS);
    expect(part.regions[1]?.pattern).toMatchObject({ ...ROWS, pitchLane: [7] });
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });

  it('opens a song without them silently and exports it without them', () => {
    const first = makeArrangement(song({}));
    expect(first.corrections).toEqual([]);
    expect(first.document.parts[0]?.sequencer).not.toHaveProperty('ratchets');
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.document).toEqual(first.document);
  });
});
