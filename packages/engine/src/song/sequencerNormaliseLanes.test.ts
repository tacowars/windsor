/**
 * A grid's step modulation lanes through the document normaliser
 * (windsor#17, decision 5): an unknown or repeated parameter dropped, values
 * clamped to -1..1, each lane as long as the steps, at most
 * `STEP_MOD_LANES_MAX` of them; and the round trip of a song with lanes and
 * of an old song without.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from './arrangementFields';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { gridNote } from '../sequencing/gridSequencer';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { makePatch } from '../patch/patch';
import { STEP_MOD_LANES_MAX } from '../sequencing/stepModLanes';
import { VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';
import { normaliseSequencer } from './sequencerNormalise';

const PATH = 'parts[0].sequencer';
const STEPS = [gridNote(0), gridNote(2), gridNote(4)];

function lanes(raw: unknown): { lanes: unknown; corrections: string[] } {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ kind: 'grid', seed: 0, steps: STEPS, lanes: raw }, PATH, n);
  return { lanes: spec.kind === 'grid' ? spec.lanes : null, corrections: n.corrections };
}

describe('grid lanes through the normaliser (windsor#17)', () => {
  it('absent is no lanes, with nothing to report', () => {
    expect(lanes(undefined)).toEqual({ lanes: [], corrections: [] });
  });

  it('keeps a well-formed lane exactly', () => {
    const lane = { param: 'filter.cutoff', values: [0, 0.5, -1] };
    expect(lanes([lane])).toEqual({ lanes: [lane], corrections: [] });
  });

  it('drops an unknown parameter and a repeated one, and reports each', () => {
    const { lanes: kept, corrections } = lanes([
      { param: 'volume', values: [0, 0, 0] },
      { param: 'ops.0.width', values: [0, 0, 0] },
      { param: 'ops.0.width', values: [1, 1, 1] },
    ]);
    expect(kept).toEqual([{ param: 'ops.0.width', values: [0, 0, 0] }]);
    expect(corrections).toEqual([
      `${PATH}.lanes[0]: "volume" is not a parameter a lane can modulate — lane dropped`,
      `${PATH}.lanes[2]: ops.0.width already has a lane — lane dropped`,
    ]);
  });

  it('clamps each value to -1..1 and makes junk 0', () => {
    const { lanes: kept, corrections } = lanes([
      { param: 'filter.resonance', values: [2, -3, 'up'] },
    ]);
    expect(kept).toEqual([{ param: 'filter.resonance', values: [1, -1, 0] }]);
    expect(corrections).toEqual([
      `${PATH}.lanes[0].values[0]: clamped 2 to 1`,
      `${PATH}.lanes[0].values[1]: clamped -3 to -1`,
      `${PATH}.lanes[0].values[2]: "up" is not a number — using 0`,
    ]);
  });

  it('pads a short lane with 0 and trims a long one to the step count', () => {
    const { lanes: kept, corrections } = lanes([
      { param: 'filter.cutoff', values: [0.5] },
      { param: 'ops.2.level', values: [0.1, 0.2, 0.3, 0.4, 0.5] },
    ]);
    expect(kept).toEqual([
      { param: 'filter.cutoff', values: [0.5, 0, 0] },
      { param: 'ops.2.level', values: [0.1, 0.2, 0.3] },
    ]);
    expect(corrections).toEqual([
      `${PATH}.lanes[0].values: 1 values for 3 steps — resized`,
      `${PATH}.lanes[1].values: 5 values for 3 steps — resized`,
    ]);
  });

  it(`keeps at most ${STEP_MOD_LANES_MAX} lanes`, () => {
    const raw = VOICE_TARGET_PATHS.slice(0, STEP_MOD_LANES_MAX + 1).map((param) => ({
      param,
      values: [0, 0, 0],
    }));
    const { lanes: kept, corrections } = lanes(raw);
    expect(kept).toEqual(raw.slice(0, STEP_MOD_LANES_MAX));
    expect(corrections).toEqual([
      `${PATH}.lanes[${STEP_MOD_LANES_MAX}]: more than ${STEP_MOD_LANES_MAX} lanes — lane dropped`,
    ]);
  });

  it('a junk lane list is no lanes; a junk values list is all 0; an unknown key is dropped', () => {
    expect(lanes('wobble')).toEqual({
      lanes: [],
      corrections: [`${PATH}.lanes: "wobble" is not a list of lanes — no lanes`],
    });
    expect(lanes([{ param: 'filter.cutoff', values: 3, depth: 2 }])).toEqual({
      lanes: [{ param: 'filter.cutoff', values: [0, 0, 0] }],
      corrections: [
        `${PATH}.lanes[0].depth: unknown key dropped`,
        `${PATH}.lanes[0].values: 3 is not a list of values — all 0`,
      ],
    });
  });
});

/** A one-part song whose grid line carries `extra`. */
function song(extra: Record<string, unknown>): Record<string, unknown> {
  const regions = [{ start: 0, duration: TICKS_PER_BAR }];
  return {
    version: ARRANGEMENT_VERSION,
    transport: { bpm: 120, bars: 1 },
    harmony: { root: 0, scale: 'naturalMinor' },
    patches: { acid: makePatch({ name: 'acid' }) },
    parts: [
      {
        slot: 0,
        name: 'line',
        preset: 'acid',
        velocity: 0.7,
        regions,
        sequencer: { kind: 'grid', seed: 3, steps: STEPS, ...extra },
      },
    ],
  };
}

describe('a song with lanes, and an old one without, round trip (windsor#17)', () => {
  it('keeps a song’s lanes through export and import', () => {
    const written = [
      { param: 'filter.cutoff', values: [0, 0.5, 0] },
      { param: 'ops.1.env.decayCurve', values: [-1, 0, 0.25] },
    ];
    const first = makeArrangement(song({ lanes: written }));
    expect(first.corrections).toEqual([]);
    expect(isShippable(first)).toBe(true);
    const sequencer = first.document.parts[0]?.sequencer;
    expect(sequencer?.kind === 'grid' && sequencer.lanes).toEqual(written);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });

  it('opens an old song without lanes as no lanes, silently, and exports it stably', () => {
    const first = makeArrangement(song({}));
    expect(first.corrections).toEqual([]);
    const sequencer = first.document.parts[0]?.sequencer;
    expect(sequencer?.kind === 'grid' && sequencer.lanes).toEqual([]);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
