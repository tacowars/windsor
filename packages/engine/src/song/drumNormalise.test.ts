/**
 * A Drum part's sequencer through the normaliser and a song round trip
 * (windsor#948, record `2026-10-24-drum-sequencer` decisions 2, 3 and 8):
 * a new part at its defaults, a hit's fields clamped and reported, and every
 * field kept through export and import.
 */
import { describe, expect, it } from 'vitest';

import { currentDocument } from '../__fixtures__/arrangementDocumentFiles';
import { DEFAULT_DRUM_CONFIG } from '../sequencing/drumSequencer';
import { DRUM_REST, drumHit } from '../sequencing/drumSteps';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { FieldNormaliser } from './arrangementFields';
import { makeArrangement } from './arrangementDocument';
import { normaliseRegionPattern, normaliseSequencer } from './sequencerNormalise';

const normalise = (raw: unknown, n = new FieldNormaliser()) =>
  normaliseSequencer(raw, 'sequencer', n);

/** `spec` without its seed, as a region pattern or a rack carries it. */
function withoutSeed<T extends { seed: number }>(spec: T): Omit<T, 'seed'> {
  const copy: Partial<T> = { ...spec };
  delete copy.seed;
  return copy as Omit<T, 'seed'>;
}

describe('a part whose kind becomes drum', () => {
  it('normalises to the defaults: four on the floor on 60 at gate 0.5, nothing varied', () => {
    const n = new FieldNormaliser();
    expect(normalise({ kind: 'drum', seed: 0 }, n)).toEqual({
      kind: 'drum',
      ...DEFAULT_DRUM_CONFIG,
    });
    expect(n.corrections).toEqual([]);
  });

  it('follows the song’s meter for its first bar', () => {
    const n = new FieldNormaliser();
    n.meter = '7/8';
    const spec = normalise({ kind: 'drum', seed: 0 }, n);
    expect(spec.kind === 'drum' && spec.steps.length).toBe(14);
  });
});

describe('a hit', () => {
  it('clamps pitch to ±24, velocity to 0–1 and ratchet to 1–4, each reported', () => {
    const n = new FieldNormaliser();
    const spec = normalise(
      {
        kind: 'drum',
        seed: 0,
        steps: [
          { kind: 'hit', pitch: 30, velocity: 1.5, ratchet: 9 },
          { kind: 'hit', pitch: -25.4, accent: 'yes' },
          { kind: 'rest', velocity: 0.5, ratchet: 2 },
          { kind: 'tie' },
        ],
      },
      n,
    );
    expect(spec.kind === 'drum' && spec.steps).toEqual([
      { kind: 'hit', accent: false, pitch: 24, ratchet: 4 },
      { kind: 'hit', accent: false, pitch: -24 },
      DRUM_REST,
      drumHit(),
    ]);
    expect(n.corrections).toEqual([
      'sequencer.steps[0].velocity: clamped 1.5 to 1',
      'sequencer.steps[0].pitch: clamped 30 to 24',
      'sequencer.steps[0].ratchet: clamped 9 to 4',
      'sequencer.steps[1].pitch: clamped -25.4 to -24',
      'sequencer.steps[1].accent: "yes" is not a boolean — using false',
      'sequencer.steps[2].ratchet: a rest plays no hit — ratchet dropped',
      'sequencer.steps[2].velocity: unknown key dropped',
      'sequencer.steps[3].kind: "tie" is not one of rest|hit — using hit',
    ]);
  });

  it('a length past the steps, a junk note and a gate under the floor are fixed and reported', () => {
    const n = new FieldNormaliser();
    const spec = normalise({ kind: 'drum', seed: 0, length: 40, note: 200, gate: 0 }, n);
    expect(spec).toMatchObject({ length: 16, note: 127, gate: 0.01 });
    expect(n.corrections).toHaveLength(3);
  });

  it('a region pattern of kind drum normalises without its seed', () => {
    const n = new FieldNormaliser();
    const pattern = normaliseRegionPattern({ kind: 'drum', note: 36 }, 'drum', 'pattern', n);
    expect(pattern).toMatchObject({ kind: 'drum', note: 36 });
    expect(pattern).not.toHaveProperty('seed');
    expect(n.corrections).toEqual([]);
  });
});

describe('a song round trip', () => {
  it('keeps every field, a hit’s velocity, pitch and ratchet and a region’s pattern included', () => {
    const steps = [
      drumHit({ velocity: 0.35, pitch: -5, ratchet: 3, accent: true }),
      DRUM_REST,
      drumHit({ pitch: 12 }),
    ];
    const sequencer = {
      kind: 'drum',
      ...DEFAULT_DRUM_CONFIG,
      steps,
      length: 2,
      note: 36,
      gate: 0.8,
      randomness: 0.4,
      probability: 0.6,
      restsSound: true,
      octaveMode: true,
      chancePerEffect: true,
      seed: 11,
      lanes: [{ param: 'filter.cutoff', values: [0.5, 0, -0.25] }],
    };
    const pattern = withoutSeed({ ...sequencer, note: 38 });
    const doc = currentDocument('roll-part');
    const [part] = doc.parts as Record<string, unknown>[];
    const regions = [
      { start: 0, duration: TICKS_PER_BAR },
      { start: TICKS_PER_BAR, duration: TICKS_PER_BAR, pattern },
    ];
    const raw = { ...doc, parts: [{ ...part, regions, sequencer }] };
    const first = makeArrangement(raw);
    expect(first.corrections).toEqual([]);
    expect(first.document.parts[0]?.sequencer).toEqual(sequencer);
    expect(first.document.parts[0]?.regions[1]?.pattern).toEqual(pattern);
    const text = JSON.stringify(first.document);
    expect(JSON.stringify(makeArrangement(JSON.parse(text)).document)).toBe(text);
  });
});
