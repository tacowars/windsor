/**
 * The grid kind through the document normaliser (#602): ranges, corrections
 * by path, the defaults an absent field takes, and the shape a song keeps —
 * and, since #705, every sequencer's own `seed` and the full `arp` and
 * `bass` field sets.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from './arrangementFields';
import { isShippable, makeArrangement } from './arrangementDocument';
import {
  ARP_OCTAVES_MAX,
  ARRANGEMENT_VERSION,
  GATE_MIN,
  GRID_STEPS_MAX,
  HARMONY_DEGREE_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import { CHORD_VOICING_DEFAULT, CHORD_VOICING_IDS } from '../harmony/chordTables';
import { ARP_STYLES, DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { BASS_PITCH_MODES, DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import { DEFAULT_GRID_CONFIG, gridNote } from '../sequencing/gridSequencer';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { makePatch } from '../patch/patch';
import { normaliseSequencer } from './sequencerNormalise';

function grid(raw: Record<string, unknown>): {
  spec: ReturnType<typeof normaliseSequencer>;
  n: FieldNormaliser;
} {
  const n = new FieldNormaliser();
  // A written seed unless the case says otherwise: a missing one is reported (#705).
  return {
    spec: normaliseSequencer({ kind: 'grid', seed: 0, ...raw }, 'parts[0].sequencer', n),
    n,
  };
}

/** Any kind through the normaliser, exactly as written. */
function sequencer(raw: Record<string, unknown>): {
  spec: ReturnType<typeof normaliseSequencer>;
  n: FieldNormaliser;
} {
  const n = new FieldNormaliser();
  return { spec: normaliseSequencer(raw, 'parts[0].sequencer', n), n };
}

const PATH = 'parts[0].sequencer';

describe('grid sequencer normalisation (#602)', () => {
  it('an absent field takes the constants default; a bare kind is the default bar', () => {
    const { spec, n } = grid({});
    expect(n.corrections).toEqual([]);
    expect(spec).toStrictEqual({ kind: 'grid', ...DEFAULT_GRID_CONFIG });
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
      register: { octave: 5 },
      seed: 77,
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
      register: { octave: 5 },
      seed: 77,
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
    const regions = [{ start: 0, duration: TICKS_PER_BAR }];
    const raw = {
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
          sequencer: {
            kind: 'grid',
            seed: 3,
            steps: [gridNote(0), { kind: 'tie' }, gridNote(4, { slide: true })],
          },
        },
        {
          slot: 1,
          name: 'idle',
          preset: 'acid',
          velocity: 0.7,
          regions,
          sequencer: { kind: 'none' },
        },
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

describe('a sequencer seed (#705)', () => {
  it('a missing seed on a euclidean, grid, arp or bass sequencer is reported and 0', () => {
    for (const kind of ['euclidean', 'grid', 'arp', 'bass']) {
      const { spec, n } = sequencer({ kind });
      expect(spec).toMatchObject({ kind, seed: 0 });
      expect(n.corrections).toEqual([`${PATH}.seed: missing — using 0`]);
    }
  });

  it('a junk seed is corrected like any integer; a chord part takes none', () => {
    const rounded = grid({ seed: 2.5 });
    expect(rounded.spec).toMatchObject({ seed: 3 });
    expect(rounded.n.corrections).toEqual([`${PATH}.seed: rounded 2.5 to 3`]);
    const chord = sequencer({ kind: 'chord' });
    expect(chord.n.corrections).toEqual([]);
    expect(chord.spec).not.toHaveProperty('seed');
    expect(sequencer({ kind: 'chord', seed: 4 }).n.corrections).toEqual([
      `${PATH}.seed: unknown key dropped`,
    ]);
  });

  it('a grid register is absolute: default octave 2, clamped to -1..9', () => {
    const low = grid({ register: { octave: -4 } });
    expect(low.spec).toMatchObject({ register: { octave: REGISTER_OCTAVE_MIN } });
    expect(low.n.corrections).toEqual([
      `${PATH}.register.octave: clamped -4 to ${REGISTER_OCTAVE_MIN}`,
    ]);
    expect(grid({}).spec).toMatchObject({ register: { octave: 2 } });
  });
});

describe('arp sequencer normalisation (#705)', () => {
  it('a bare kind with a seed is the default arp, silently; a full one round-trips', () => {
    const bare = sequencer({ kind: 'arp', seed: 0 });
    expect(bare.n.corrections).toEqual([]);
    expect(bare.spec).toStrictEqual({ kind: 'arp', ...DEFAULT_ARP_CONFIG });
    const written = {
      kind: 'arp',
      style: 'converge',
      divisor: 12,
      gate: 0.4,
      octaves: 3,
      voicing: 'drop2',
      retrigger: true,
      register: { octave: 5 },
      seed: 9,
    };
    const full = sequencer(written);
    expect(full.n.corrections).toEqual([]);
    expect(full.spec).toStrictEqual(written);
  });

  it('clamps and reports every field by path', () => {
    const { spec, n } = sequencer({
      kind: 'arp',
      style: 'sideways',
      divisor: 5,
      gate: 0,
      octaves: 9,
      voicing: 'wide',
      retrigger: 'yes',
      register: { octave: 12 },
      seed: 1.2,
      swing: 1,
    });
    expect(n.corrections).toEqual([
      `${PATH}.swing: unknown key dropped`,
      `${PATH}.style: "sideways" is not one of ${ARP_STYLES.join('|')} — using ${DEFAULT_ARP_CONFIG.style}`,
      `${PATH}.divisor: 5 does not divide the ${TICKS_PER_BAR}-tick bar — using ${DEFAULT_ARP_CONFIG.divisor}`,
      `${PATH}.gate: clamped 0 to ${GATE_MIN}`,
      `${PATH}.octaves: clamped 9 to ${ARP_OCTAVES_MAX}`,
      `${PATH}.voicing: "wide" is not one of ${CHORD_VOICING_IDS.join('|')} — using ${CHORD_VOICING_DEFAULT}`,
      `${PATH}.retrigger: "yes" is not a boolean — using ${DEFAULT_ARP_CONFIG.retrigger}`,
      `${PATH}.register.octave: clamped 12 to ${REGISTER_OCTAVE_MAX}`,
      `${PATH}.seed: rounded 1.2 to 1`,
    ]);
    expect(spec).toStrictEqual({
      kind: 'arp',
      ...DEFAULT_ARP_CONFIG,
      gate: GATE_MIN,
      octaves: ARP_OCTAVES_MAX,
      register: { octave: REGISTER_OCTAVE_MAX },
      seed: 1,
    });
  });
});

describe('bass sequencer normalisation (#705)', () => {
  it('a bare kind with a seed is the default bass, silently; a full one round-trips', () => {
    const bare = sequencer({ kind: 'bass', seed: 0 });
    expect(bare.n.corrections).toEqual([]);
    expect(bare.spec).toStrictEqual({ kind: 'bass', ...DEFAULT_BASS_CONFIG });
    const written = {
      kind: 'bass',
      pitchMode: 'fixed',
      rootBias: 0.25,
      fixedDegree: 4,
      divisor: 24,
      gate: 0.9,
      register: { octave: 0 },
      density: 0.5,
      seed: 12,
    };
    const full = sequencer(written);
    expect(full.n.corrections).toEqual([]);
    expect(full.spec).toStrictEqual(written);
  });

  it('clamps and reports every field by path', () => {
    const { spec, n } = sequencer({
      kind: 'bass',
      pitchMode: 'walking',
      rootBias: 2,
      fixedDegree: 99,
      divisor: 7,
      gate: 3,
      register: { octave: -3 },
      density: -1,
      seed: 'abc',
    });
    expect(n.corrections).toEqual([
      `${PATH}.pitchMode: "walking" is not one of ${BASS_PITCH_MODES.join('|')} — using ${DEFAULT_BASS_CONFIG.pitchMode}`,
      `${PATH}.rootBias: clamped 2 to 1`,
      `${PATH}.fixedDegree: clamped 99 to ${HARMONY_DEGREE_MAX}`,
      `${PATH}.divisor: 7 does not divide the ${TICKS_PER_BAR}-tick bar — using ${DEFAULT_BASS_CONFIG.divisor}`,
      `${PATH}.gate: clamped 3 to 1`,
      `${PATH}.register.octave: clamped -3 to ${REGISTER_OCTAVE_MIN}`,
      `${PATH}.density: clamped -1 to 0`,
      `${PATH}.seed: "abc" is not a number — using 0`,
    ]);
    expect(spec).toStrictEqual({
      kind: 'bass',
      ...DEFAULT_BASS_CONFIG,
      rootBias: 1,
      fixedDegree: HARMONY_DEGREE_MAX,
      gate: 1,
      register: { octave: REGISTER_OCTAVE_MIN },
      density: 0,
      seed: 0,
    });
  });
});
