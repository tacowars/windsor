/**
 * The chord kind through the document normaliser (#606): ranges, corrections
 * by path, the defaults an absent field takes, and the shape a song keeps
 * through export → `makeArrangement` → export.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from './arrangementFields';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ARRANGEMENT_VERSION, CHORD_STEPS_MAX } from './audioConstants';
import {
  CHORD_DIVISORS,
  CHORD_DURATIONS,
  CHORD_VOICING_DEFAULT,
  CHORD_VOICING_IDS,
} from './chordTables';
import { DEFAULT_CHORD_CONFIG, chordStep, restStep } from './chordSequencer';
import { makePatch } from './patch';
import { normaliseSequencer } from './sequencerNormalise';

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
    expect(spec).toEqual({
      kind: 'chord',
      ...DEFAULT_CHORD_CONFIG,
      seed: undefined,
      generatorIndex: undefined,
    });
    expect(spec.kind === 'chord' && spec.steps).toEqual([]);
  });

  it('keeps every field a written progression carries', () => {
    const steps = [
      {
        kind: 'chord',
        degree: 5,
        size: 4,
        inversion: 2,
        octave: -1,
        semitone: 3,
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
      register: { octave: -2 },
    });
    expect(n.corrections).toEqual([]);
    expect(spec).toEqual({
      kind: 'chord',
      divisor: 24,
      gate: 0.5,
      voicing: 'drop2',
      register: { octave: -2 },
      steps,
    });
  });

  it('a step with only a kind takes the step defaults', () => {
    const { spec, n } = chord({ steps: [{ kind: 'chord' }, { kind: 'rest' }] });
    expect(n.corrections).toEqual([]);
    expect(spec.kind === 'chord' && spec.steps).toEqual([chordStep(0), restStep()]);
  });

  it('corrects each out-of-table or out-of-range field by path', () => {
    const { spec, n } = chord({
      divisor: 6,
      gate: 2,
      voicing: 'wide',
      steps: [
        { kind: 'tie', duration: 1 },
        { kind: 'chord', degree: -2, size: 5, inversion: 4, octave: 3, semitone: -12 },
        { kind: 'chord', duration: 0.3, repeat: 9 },
      ],
    });
    expect(n.corrections).toEqual([
      `${PATH}.divisor: 6 is not one of ${CHORD_DIVISORS.join('|')} — using ${DEFAULT_CHORD_CONFIG.divisor}`,
      `${PATH}.gate: clamped 2 to 1`,
      `${PATH}.voicing: "wide" is not one of ${CHORD_VOICING_IDS.join('|')} — using ${CHORD_VOICING_DEFAULT}`,
      `${PATH}.steps[0].kind: "tie" is not one of rest|chord — using rest`,
      `${PATH}.steps[1].degree: clamped -2 to 0`,
      `${PATH}.steps[1].size: 5 is not a triad (3) or a seventh (4) — using a triad`,
      `${PATH}.steps[1].inversion: clamped 4 to 3`,
      `${PATH}.steps[1].octave: clamped 3 to 2`,
      `${PATH}.steps[1].semitone: clamped -12 to -11`,
      `${PATH}.steps[2].duration: 0.3 is not one of ${CHORD_DURATIONS.join('|')} — using ${restStep().duration}`,
      `${PATH}.steps[2].repeat: clamped 9 to 8`,
    ]);
    expect(spec).toEqual({
      kind: 'chord',
      ...DEFAULT_CHORD_CONFIG,
      seed: undefined,
      generatorIndex: undefined,
      steps: [
        restStep(),
        chordStep(0, { inversion: 3, octave: 2, semitone: -11 }),
        chordStep(0, { repeat: 8 }),
      ],
    });
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
    const doc = {
      version: ARRANGEMENT_VERSION,
      seed: 1,
      bpm: 100,
      key: { root: 57, scale: 'naturalMinor' },
      patches: { pad: makePatch({ name: 'pad' }) },
      parts: [
        {
          slot: 0,
          preset: 'pad',
          sequencer: {
            kind: 'chord',
            voicing: 'spread',
            steps: [
              chordStep(0, { size: 4 }),
              chordStep(5, { duration: 2 }),
              restStep({ duration: 0.5, repeat: 2 }),
            ],
          },
        },
        { slot: 1, preset: 'pad', sequencer: { kind: 'chord' } },
      ],
    };
    const first = makeArrangement(doc);
    expect(first.corrections).toEqual([]);
    expect(isShippable(first)).toBe(true);
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.corrections).toEqual([]);
    expect(second.document).toEqual(first.document);
    expect(second.document.parts[1]?.sequencer).toEqual({
      kind: 'chord',
      ...DEFAULT_CHORD_CONFIG,
      seed: undefined,
      generatorIndex: undefined,
    });
  });
});
