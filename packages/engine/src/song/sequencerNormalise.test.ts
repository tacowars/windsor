/**
 * The grid kind through the document normaliser (#602): ranges, corrections
 * by path, the defaults an absent field takes, and the shape a song keeps.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from './arrangementFields';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ARRANGEMENT_VERSION, GRID_STEPS_MAX } from '../audioConstants';
import { DEFAULT_GRID_CONFIG, gridNote } from '../sequencing/gridSequencer';
import { makePatch } from '../patch/patch';
import { normaliseSequencer } from './sequencerNormalise';

function grid(raw: Record<string, unknown>): {
  spec: ReturnType<typeof normaliseSequencer>;
  n: FieldNormaliser;
} {
  const n = new FieldNormaliser();
  return { spec: normaliseSequencer({ kind: 'grid', ...raw }, 'parts[0].sequencer', n), n };
}

describe('grid sequencer normalisation (#602)', () => {
  it('an absent field takes the constants default; a bare kind is the default bar', () => {
    const { spec, n } = grid({});
    expect(n.corrections).toEqual([]);
    expect(spec).toEqual({
      kind: 'grid',
      ...DEFAULT_GRID_CONFIG,
      seed: undefined,
      generatorIndex: undefined,
    });
    expect(spec.kind === 'grid' && spec.steps).toHaveLength(16);
  });

  it('keeps every step field a written line carries', () => {
    const steps = [
      { kind: 'note', degree: 3, octave: -1, accent: true, slide: true },
      { kind: 'tie' },
      { kind: 'rest' },
    ];
    const { spec, n } = grid({
      steps,
      divisor: 12,
      skipChance: 0.3,
      accentVelocity: 0.5,
      accentMod: 0.4,
      register: { octave: -2 },
    });
    expect(n.corrections).toEqual([]);
    expect(spec).toEqual({
      kind: 'grid',
      divisor: 12,
      steps,
      length: 3,
      skipChance: 0.3,
      accentVelocity: 0.5,
      accentMod: 0.4,
      register: { octave: -2 },
    });
  });

  it('a length past the steps written is clamped to them; absent, it is the whole line', () => {
    const { spec, n } = grid({ steps: [gridNote(), gridNote(), gridNote()], length: 9 });
    expect(spec.kind === 'grid' && spec.length).toBe(3);
    expect(n.corrections).toEqual(['parts[0].sequencer.length: clamped 9 to 3']);
    const short = grid({ steps: [gridNote(), gridNote(), gridNote()], length: 2 });
    expect(short.spec.kind === 'grid' && short.spec.length).toBe(2);
    expect(short.spec.kind === 'grid' && short.spec.steps).toHaveLength(3);
  });

  it('caps 33 steps to 32 and reports it', () => {
    const { spec, n } = grid({
      steps: Array.from({ length: GRID_STEPS_MAX + 1 }, () => gridNote()),
    });
    expect(spec.kind === 'grid' && spec.steps).toHaveLength(GRID_STEPS_MAX);
    expect(n.corrections).toEqual([
      `parts[0].sequencer.steps: 33 steps capped to ${GRID_STEPS_MAX}`,
    ]);
  });

  it('corrects an unknown step kind, a negative degree and an out-of-range octave by path', () => {
    const { spec, n } = grid({
      steps: [{ kind: 'bang' }, { kind: 'note', degree: -3 }, { kind: 'note', octave: 9 }],
    });
    expect(spec.kind === 'grid' && spec.steps).toEqual([
      gridNote(0),
      gridNote(0),
      gridNote(0, { octave: 2 }),
    ]);
    expect(n.corrections).toEqual([
      'parts[0].sequencer.steps[0].kind: "bang" is not one of rest|tie|note — using note',
      'parts[0].sequencer.steps[1].degree: clamped -3 to 0',
      'parts[0].sequencer.steps[2].octave: clamped 9 to 2',
    ]);
  });

  it('a junk step list is the default bar, and a string flag is junk', () => {
    const { spec, n } = grid({ steps: 'ratatat' });
    expect(spec.kind === 'grid' && spec.steps).toEqual(DEFAULT_GRID_CONFIG.steps);
    expect(n.corrections).toEqual([
      'parts[0].sequencer.steps: "ratatat" is not a list of steps — using the default bar',
    ]);
    const flagged = grid({ steps: [{ kind: 'note', accent: 'yes' }] });
    expect(flagged.spec.kind === 'grid' && flagged.spec.steps[0]).toEqual(gridNote(0));
    expect(flagged.n.corrections).toEqual([
      'parts[0].sequencer.steps[0].accent: "yes" is not a boolean — using false',
    ]);
  });

  it('a song whose only sequenced part is a grid is shippable, and export is stable', () => {
    const raw = {
      version: ARRANGEMENT_VERSION,
      seed: 3,
      bpm: 120,
      key: { root: 48, scale: 'naturalMinor' },
      patches: { acid: makePatch({ name: 'acid' }) },
      parts: [
        {
          slot: 0,
          name: 'line',
          preset: 'acid',
          velocity: 0.7,
          sequencer: {
            kind: 'grid',
            steps: [gridNote(0), { kind: 'tie' }, gridNote(4, { slide: true })],
          },
        },
        { slot: 1, name: 'idle', preset: 'acid', velocity: 0.7, sequencer: { kind: 'none' } },
      ],
    };
    const first = makeArrangement(raw);
    expect(first.corrections).toEqual([]);
    expect(isShippable(first)).toBe(true);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
