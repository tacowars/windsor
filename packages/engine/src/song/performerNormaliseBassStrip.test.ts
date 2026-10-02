/**
 * Basslead's step strip through the document normaliser (windsor#367
 * decisions 6–8): absent fields are one bar of plain notes at the part's
 * divisor, silently; a strip is kept exactly; every correction the Grid's
 * strip would get is made and reported the same way; and a song with a
 * strip round-trips, a region's own pattern included.
 */
import { describe, expect, it } from 'vitest';

import { GRID_STEPS_MAX, GRID_STEP_OCTAVE_MAX, RATCHET_MAX } from '../audioConstants';
import {
  DEFAULT_BASS_CONFIG,
  bassNote,
  defaultBassSteps,
  type BassStep,
} from '../sequencing/bassSequencer';
import { DIVISORS, TICKS_PER_BAR } from '../sequencing/scheduler';
import { STEP_MOD_LANES_MAX, STEP_MOD_PARAMS } from '../worklet/fm/stepModTables';
import { song } from '../__fixtures__/documentCases';
import { FieldNormaliser } from './arrangementFields';
import { isShippable, makeArrangement } from './arrangementDocument';
import { normaliseSequencer } from './sequencerNormalise';

const PATH = 'parts[0].sequencer';

function bass(raw: Record<string, unknown>): {
  spec: Record<string, unknown>;
  corrections: string[];
} {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ kind: 'bass', seed: 0, ...raw }, PATH, n);
  return { spec: spec as unknown as Record<string, unknown>, corrections: n.corrections };
}

const STRIP: BassStep[] = [
  bassNote({ accent: true, ratchet: 3 }),
  { kind: 'tie' },
  { kind: 'rest' },
  bassNote({ octave: -2, slide: true }),
  bassNote({ octave: 1 }),
];

describe('the Basslead strip through the normaliser (windsor#367)', () => {
  it('a bass with no strip fields is one bar of plain notes at its divisor, silently', () => {
    const { spec, corrections } = bass({});
    expect(corrections).toEqual([]);
    expect(spec).toStrictEqual({ kind: 'bass', ...DEFAULT_BASS_CONFIG });
    expect(spec.steps).toEqual(defaultBassSteps(DIVISORS.eighth));
    expect(spec).toMatchObject({ length: 8, lanes: [], accentVelocity: 0.2, accentMod: 1 });
    expect(bass({ divisor: DIVISORS.sixteenth }).spec).toMatchObject({
      steps: defaultBassSteps(DIVISORS.sixteenth),
      length: TICKS_PER_BAR / DIVISORS.sixteenth,
    });
  });

  it('a bar of more than 32 steps is capped at 32, silently', () => {
    const { spec, corrections } = bass({ divisor: 2 });
    expect(corrections).toEqual([]);
    expect(spec.steps).toHaveLength(GRID_STEPS_MAX);
    expect(spec.length).toBe(GRID_STEPS_MAX);
  });

  it('keeps a written strip exactly, the steps past `length` included', () => {
    const lanes = [{ param: 'filter.cutoff', values: [0.5, 0, -0.5, 0, 1] }];
    const written = { steps: STRIP, length: 3, lanes, accentVelocity: 0.6, accentMod: 0.4 };
    const { spec, corrections } = bass(written);
    expect(corrections).toEqual([]);
    expect(spec).toStrictEqual({ kind: 'bass', ...DEFAULT_BASS_CONFIG, ...written });
  });

  it('clamps and reports a step’s fields, and drops a rest’s ratchet', () => {
    const { spec, corrections } = bass({
      steps: [
        { kind: 'note', octave: 9, accent: 'yes', ratchet: 7 },
        { kind: 'rest', ratchet: 2 },
        { kind: 'hold' },
      ],
    });
    expect(spec.steps).toEqual([
      bassNote({ octave: GRID_STEP_OCTAVE_MAX, ratchet: RATCHET_MAX }),
      { kind: 'rest' },
      bassNote(),
    ]);
    expect(corrections).toEqual([
      `${PATH}.steps[0].octave: clamped 9 to ${GRID_STEP_OCTAVE_MAX}`,
      `${PATH}.steps[0].accent: "yes" is not a boolean — using false`,
      `${PATH}.steps[0].ratchet: clamped 7 to ${RATCHET_MAX}`,
      `${PATH}.steps[1].ratchet: a rest plays no hit — ratchet dropped`,
      `${PATH}.steps[2].kind: "hold" is not one of rest|tie|note — using note`,
    ]);
  });

  it('caps the steps at 32 and a junk list is a bar of plain notes, each reported', () => {
    const long = bass({ steps: Array.from({ length: 40 }, () => bassNote()) });
    expect(long.spec.steps).toHaveLength(GRID_STEPS_MAX);
    expect(long.corrections).toEqual([`${PATH}.steps: 40 steps capped to ${GRID_STEPS_MAX}`]);
    const junk = bass({ steps: 'xx..', divisor: DIVISORS.quarter });
    expect(junk.spec.steps).toEqual(defaultBassSteps(DIVISORS.quarter));
    expect(junk.corrections).toEqual([
      `${PATH}.steps: "xx.." is not a list of steps — using a bar of plain notes`,
    ]);
  });

  it('fits `length` to the steps written, reported', () => {
    expect(bass({ steps: STRIP, length: 9 })).toMatchObject({
      spec: { length: STRIP.length },
      corrections: [`${PATH}.length: clamped 9 to ${STRIP.length}`],
    });
    expect(bass({ steps: STRIP, length: 0 })).toMatchObject({
      spec: { length: 1 },
      corrections: [`${PATH}.length: clamped 0 to 1`],
    });
  });

  it('fits the lanes to the steps and caps their count, each reported', () => {
    const tooMany = STEP_MOD_PARAMS.slice(0, STEP_MOD_LANES_MAX + 1).map((param) => ({
      param,
      values: [0.5],
    }));
    const { spec, corrections } = bass({ steps: STRIP, lanes: tooMany });
    const lanes = spec.lanes as Array<{ values: number[] }>;
    expect(lanes).toHaveLength(STEP_MOD_LANES_MAX);
    expect(lanes.every((lane) => lane.values.length === STRIP.length)).toBe(true);
    expect(corrections).toContain(
      `${PATH}.lanes[0].values: 1 values for ${STRIP.length} steps — resized`,
    );
    expect(corrections).toContain(
      `${PATH}.lanes[${STEP_MOD_LANES_MAX}]: more than ${STEP_MOD_LANES_MAX} lanes — lane dropped`,
    );
  });

  it('clamps the accent amounts, reported', () => {
    const { spec, corrections } = bass({ accentVelocity: 2, accentMod: -1 });
    expect(spec).toMatchObject({ accentVelocity: 1, accentMod: 0 });
    expect(corrections).toEqual([
      `${PATH}.accentVelocity: clamped 2 to 1`,
      `${PATH}.accentMod: clamped -1 to 0`,
    ]);
  });

  it('a song with a strip round-trips, on the part and on a region’s pattern', () => {
    const lanes = [{ param: 'filter.cutoff', values: [0.5, 0, -0.5, 0, 1] }];
    const strip = { kind: 'bass', ...DEFAULT_BASS_CONFIG, steps: STRIP, length: 4, lanes };
    const sequencer = { ...strip, seed: 3 };
    // A region's pattern is the part's spec less the seed.
    const pattern = { ...strip, steps: [...STRIP].reverse(), length: 5 };
    delete (pattern as Partial<typeof pattern>).seed;
    const regions = [
      { start: 0, duration: TICKS_PER_BAR },
      { start: TICKS_PER_BAR, duration: TICKS_PER_BAR, pattern },
    ];
    const written = song([{ slot: 3, name: 'bass', preset: 'drone-sqr', regions, sequencer }]);
    const result = makeArrangement(written);
    expect(result.corrections).toEqual([]);
    expect(isShippable(result)).toBe(true);
    expect(result.document.parts[0]?.sequencer).toEqual(sequencer);
    expect(result.document.parts[0]?.regions[1]).toMatchObject({ pattern });
    const again = makeArrangement(JSON.parse(JSON.stringify(result.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(result.document);
  });
});
