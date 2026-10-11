/**
 * The env ring's resolution (windsor#725): which Roll clip envelope moves a
 * patch knob, the centre it moves around and the value playing now, read
 * through the engine's own evaluator and the target row's curve.
 */
import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';
import {
  DEFAULT_ROLL_CONFIG,
  TICKS_PER_BAR,
  envelopeValueAt,
  makeMacro,
  voiceTargetRow,
  type AutomationLane,
  type DocumentPart,
  type RollEnvelope,
} from '@windsor/engine';
import {
  emptyKnobEnvelope,
  knobEnvelopeAt,
  partEnvelopeTargets,
  type KnobEnvelopeQuery,
} from './knobEnvelope';

const BAR = TICKS_PER_BAR;
const SONG = 8 * BAR;
const LOOP = BAR;

/** A sweep over the loop: −1 at its start, +1 at its middle. */
const sweep = (target: RollEnvelope['target'], on = true): RollEnvelope => ({
  target,
  on,
  points: [
    { tick: 0, value: -1, bend: 0 },
    { tick: LOOP / 2, value: 1, bend: 0.4 },
  ],
});

/** The hat part playing a one-bar roll with `envelopes` in one region over bars 3–4, and `lanes`. */
const rollPart = (
  envelopes: readonly RollEnvelope[],
  lanes: readonly AutomationLane[] = [],
): DocumentPart => ({
  ...AUTOMATION_PART,
  sequencer: { kind: 'roll', ...DEFAULT_ROLL_CONFIG, loopTicks: LOOP, envelopes },
  regions: [{ start: 2 * BAR, duration: 2 * BAR }],
  automation: lanes,
});

const query = (
  part: DocumentPart,
  path: string,
  at: Partial<KnobEnvelopeQuery> = {},
): KnobEnvelopeQuery => ({
  part,
  macros: [],
  path,
  base: 1000,
  tick: 2 * BAR + LOOP / 4,
  running: true,
  songTicks: SONG,
  ...at,
});

describe('a knob no envelope moves', () => {
  it('shows no ring: no envelope, another target, no part', () => {
    expect(knobEnvelopeAt(query(rollPart([]), 'filter.cutoff'))).toBeNull();
    expect(
      knobEnvelopeAt(query(rollPart([sweep('filter.cutoff')]), 'filter.resonance')),
    ).toBeNull();
    expect(knobEnvelopeAt({ ...query(rollPart([]), 'filter.cutoff'), part: undefined })).toBeNull();
  });

  it('shows none for an envelope that is off, or has no point inside the loop', () => {
    expect(knobEnvelopeAt(query(rollPart([sweep('filter.cutoff', false)]), 'filter.cutoff'))).toBe(
      null,
    );
    const past: RollEnvelope = {
      target: 'filter.cutoff',
      on: true,
      points: [{ tick: LOOP, value: 1, bend: 0 }],
    };
    expect(knobEnvelopeAt(query(rollPart([past]), 'filter.cutoff'))).toBeNull();
  });

  it('shows none on a target a macro mapping holds: the engine ignores the envelope', () => {
    const macros = [
      makeMacro({ name: 'Accent', mappings: [{ target: 'filter.cutoff', min: 400, max: 3200 }] }),
    ];
    const part = rollPart([sweep('filter.cutoff')]);
    expect(knobEnvelopeAt(query(part, 'filter.cutoff', { macros }))).toBeNull();
  });
});

describe('a knob an envelope moves', () => {
  const envelope = sweep('filter.cutoff');
  const part = rollPart([envelope, sweep('filter.resonance')]);
  const local = LOOP / 4;
  const value = envelopeValueAt(envelope, local, LOOP);

  it('plays a ratio row (Cutoff) at the loop tick through its curve, in octaves', () => {
    const span = voiceTargetRow('filter.cutoff')!.span;
    const env = knobEnvelopeAt(query(part, 'filter.cutoff'));
    expect(env?.base).toBe(1000);
    expect(env?.playing).toBeCloseTo(1000 * 2 ** (value * span), 6);
  });

  it('plays an add row (Resonance) by its span, in its own units', () => {
    const span = voiceTargetRow('filter.resonance')!.span;
    const env = knobEnvelopeAt(query(part, 'filter.resonance', { base: 3 }));
    expect(env?.playing).toBeCloseTo(3 + value * span, 9);
  });

  it('starts the loop again at each repeat inside the region', () => {
    const once = knobEnvelopeAt(query(part, 'filter.cutoff'))!.playing;
    const again = knobEnvelopeAt(query(part, 'filter.cutoff', { tick: 3 * BAR + local }));
    expect(again?.playing).toBe(once);
    const nextPass = knobEnvelopeAt(query(part, 'filter.cutoff', { tick: SONG + 2 * BAR + local }));
    expect(nextPass?.playing).toBe(once);
  });

  it('rests at the centre outside the region, and while the transport is stopped', () => {
    expect(knobEnvelopeAt(query(part, 'filter.cutoff', { tick: local }))).toEqual({
      base: 1000,
      playing: 1000,
    });
    expect(knobEnvelopeAt(query(part, 'filter.cutoff', { running: false }))).toEqual({
      base: 1000,
      playing: 1000,
    });
  });

  it('follows the centre a drag moves the patch to', () => {
    const moved = knobEnvelopeAt(query(part, 'filter.cutoff', { base: 2000 }));
    expect(moved?.base).toBe(2000);
    expect(moved?.playing).toBeCloseTo(
      2 * knobEnvelopeAt(query(part, 'filter.cutoff'))!.playing,
      6,
    );
  });

  it('reads a region’s own pattern, and shows for the part’s roll no region plays', () => {
    const own = {
      kind: 'roll' as const,
      ...DEFAULT_ROLL_CONFIG,
      loopTicks: LOOP,
      envelopes: [envelope],
    };
    const regionOnly: DocumentPart = {
      ...rollPart([]),
      regions: [{ start: 2 * BAR, duration: 2 * BAR, pattern: own }],
    };
    expect(knobEnvelopeAt(query(regionOnly, 'filter.cutoff'))?.playing).toBeCloseTo(
      knobEnvelopeAt(query(part, 'filter.cutoff'))!.playing,
      9,
    );
    const unplayed: DocumentPart = {
      ...part,
      regions: [
        { start: 2 * BAR, duration: BAR, pattern: { kind: 'roll', ...DEFAULT_ROLL_CONFIG } },
      ],
    };
    expect(knobEnvelopeAt(query(unplayed, 'filter.cutoff'))).toEqual({ base: 1000, playing: 1000 });
  });

  it('adds its offset over a song lane on the same target, whose value is the centre', () => {
    const lane: AutomationLane = {
      target: 'voice.filter.cutoff',
      on: true,
      points: [{ tick: 0, value: 400, bend: 0 }],
    };
    const env = knobEnvelopeAt(query(rollPart([envelope], [lane]), 'filter.cutoff'));
    expect(env?.base).toBe(400);
    expect(env?.playing).toBeCloseTo(400 * 2 ** (value * voiceTargetRow('filter.cutoff')!.span), 6);
  });

  it('writes into the knob’s own answer, and works a part out once per part object', () => {
    const build = vi.fn(partEnvelopeTargets);
    const fresh = rollPart([envelope]);
    const out = emptyKnobEnvelope();
    expect(knobEnvelopeAt(query(fresh, 'filter.cutoff'), out, build)).toBe(out);
    knobEnvelopeAt(query(fresh, 'filter.cutoff', { tick: 0 }), out, build);
    knobEnvelopeAt(query(fresh, 'filter.resonance'), out, build);
    expect(build).toHaveBeenCalledTimes(1);
    knobEnvelopeAt(query({ ...fresh }, 'filter.cutoff'), out, build);
    expect(build).toHaveBeenCalledTimes(2);
  });
});
