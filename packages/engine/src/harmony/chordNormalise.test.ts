/**
 * The chord kind through the document normaliser (#606, #705): ranges, corrections
 * by path, the defaults an absent field takes, and the shape a song keeps
 * through export → `makeArrangement` → export.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from '../song/arrangementFields';
import { isShippable, makeArrangement } from '../song/arrangementDocument';
import {
  ARRANGEMENT_VERSION,
  CHORD_INVERSION_MAX,
  CHORD_STEPS_MAX,
  CHORD_STEP_OCTAVE_MAX,
  REGISTER_OCTAVE_MAX,
} from '../audioConstants';
import {
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_VOICING_DEFAULT,
  CHORD_VOICING_IDS,
} from './chordTables';
import { DEFAULT_CHORD_CONFIG, hitStep, restStep } from '../sequencing/chordSequencer';
import { makePatch } from '../patch/patch';
import { normaliseSequencer } from '../song/sequencerNormalise';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

function chord(raw: Record<string, unknown>): {
  spec: ReturnType<typeof normaliseSequencer>;
  n: FieldNormaliser;
} {
  const n = new FieldNormaliser();
  return { spec: normaliseSequencer({ kind: 'chord', ...raw }, 'parts[0].sequencer', n), n };
}

const PATH = 'parts[0].sequencer';

describe('chord sequencer normalisation (#606)', () => {
  it('a bare kind is the empty progression at the defaults, with no correction', () => {
    const { spec, n } = chord({});
    expect(n.corrections).toEqual([]);
    // #705: a chord part carries no seed — it draws nothing.
    expect(spec).toStrictEqual({ kind: 'chord', ...DEFAULT_CHORD_CONFIG });
    expect(spec.kind === 'chord' && spec.steps).toEqual([]);
  });

  it('keeps every field a written progression carries', () => {
    const steps = [
      {
        kind: 'hit',
        inversion: 2,
        octave: -1,
        duration: 1.5,
        repeat: 2,
      },
      { kind: 'rest', duration: 0.5, repeat: 1 },
    ];
    const { spec, n } = chord({
      steps,
      divisor: 24,
      gate: 0.5,
      voicing: 'drop2',
      register: { octave: 5 },
    });
    expect(n.corrections).toEqual([]);
    expect(spec).toEqual({
      kind: 'chord',
      divisor: 24,
      gate: 0.5,
      voicing: 'drop2',
      register: { octave: 5 },
      steps,
    });
  });

  it('a step with only a kind takes the step defaults', () => {
    const { spec, n } = chord({ steps: [{ kind: 'hit' }, { kind: 'rest' }] });
    expect(n.corrections).toEqual([]);
    expect(spec.kind === 'chord' && spec.steps).toEqual([hitStep(), restStep()]);
  });

  it('corrects each out-of-table or out-of-range field by path', () => {
    const { spec, n } = chord({
      divisor: 6,
      gate: 2,
      voicing: 'wide',
      register: { octave: 10 },
      steps: [
        { kind: 'tie', duration: 1 },
        { kind: 'hit', inversion: 4, octave: 3 },
        { kind: 'hit', duration: 0.3, repeat: 9 },
      ],
    });
    expect(n.corrections).toEqual([
      `${PATH}.divisor: 6 is not one of ${CHORD_DIVISORS.join('|')} — using ${DEFAULT_CHORD_CONFIG.divisor}`,
      `${PATH}.gate: clamped 2 to 1`,
      `${PATH}.voicing: "wide" is not one of ${CHORD_VOICING_IDS.join('|')} — using ${CHORD_VOICING_DEFAULT}`,
      `${PATH}.register.octave: clamped 10 to ${REGISTER_OCTAVE_MAX}`,
      `${PATH}.steps[0].kind: "tie" is not one of rest|hit — using rest`,
      `${PATH}.steps[1].inversion: clamped 4 to ${CHORD_INVERSION_MAX}`,
      `${PATH}.steps[1].octave: clamped 3 to ${CHORD_STEP_OCTAVE_MAX}`,
      `${PATH}.steps[2].duration: 0.3 is not one of ${CHORD_DURATIONS.join('|')} — using ${restStep().duration}`,
      `${PATH}.steps[2].repeat: clamped 9 to 8`,
    ]);
    expect(spec).toStrictEqual({
      kind: 'chord',
      ...DEFAULT_CHORD_CONFIG,
      register: { octave: 9 },
      steps: [restStep(), hitStep({ inversion: 3, octave: 2 }), hitStep({ repeat: 8 })],
    });
  });

  it('a hit step drops degree, size and semitone as unknown keys, reported (#705: the chord is the harmony’s)', () => {
    const { spec, n } = chord({
      steps: [{ kind: 'hit', degree: 5, size: 4, semitone: 3, inversion: 1 }],
    });
    expect(n.corrections).toEqual([
      `${PATH}.steps[0].degree: unknown key dropped`,
      `${PATH}.steps[0].size: unknown key dropped`,
      `${PATH}.steps[0].semitone: unknown key dropped`,
    ]);
    expect(spec.kind === 'chord' && spec.steps).toStrictEqual([hitStep({ inversion: 1 })]);
  });

  it('caps an over-long list, reports junk steps and unknown keys', () => {
    const long = Array.from({ length: CHORD_STEPS_MAX + 1 }, () => ({ kind: 'rest' }));
    expect(chord({ steps: long }).n.corrections).toEqual([
      `${PATH}.steps: ${CHORD_STEPS_MAX + 1} steps capped to ${CHORD_STEPS_MAX}`,
    ]);
    const { spec, n } = chord({ steps: 'four', swing: 0.2 });
    expect(spec.kind === 'chord' && spec.steps).toEqual([]);
    expect(n.corrections).toEqual([
      `${PATH}.swing: unknown key dropped`,
      `${PATH}.steps: "four" is not a list of steps — using none`,
    ]);
    expect(chord({ steps: [{ kind: 'rest', degree: 3 }] }).n.corrections).toEqual([
      `${PATH}.steps[0].degree: unknown key dropped`,
    ]);
  });

  it('export → makeArrangement → export is stable, and a chord-only song ships', () => {
    const regions = [{ start: 0, duration: 4 * TICKS_PER_BAR }];
    const doc = {
      version: ARRANGEMENT_VERSION,
      transport: { bpm: 100, bars: 4 },
      harmony: {
        root: 9,
        scale: 'naturalMinor',
        events: [
          { start: 0, duration: 2 * TICKS_PER_BAR, degree: 0, size: 4 },
          { start: 2 * TICKS_PER_BAR, duration: 2 * TICKS_PER_BAR, degree: 5, size: 3 },
        ],
      },
      patches: { pad: makePatch({ name: 'pad' }) },
      parts: [
        {
          slot: 0,
          preset: 'pad',
          regions,
          sequencer: {
            kind: 'chord',
            voicing: 'spread',
            steps: [
              hitStep({ inversion: 1 }),
              hitStep({ duration: 2 }),
              restStep({ duration: 0.5, repeat: 2 }),
            ],
          },
        },
        { slot: 1, preset: 'pad', regions, sequencer: { kind: 'chord' } },
      ],
    };
    const first = makeArrangement(doc);
    expect(first.corrections).toEqual([]);
    expect(isShippable(first)).toBe(true);
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.corrections).toEqual([]);
    expect(second.document).toEqual(first.document);
    expect(second.document.parts[1]?.sequencer).toStrictEqual({
      kind: 'chord',
      ...DEFAULT_CHORD_CONFIG,
    });
  });
});
