/** Voicing recipes for the scoring bank. Authored settings live in presets*Tables.ts. */
import { FILTER_MODE as F, LFO_SHAPE as L, WAVE as W, makeEnvelope, makePatch } from './patch';
import type { Patch, PartialOperator } from './patch';

export type ScoringFamily = 'Strings' | 'Pads' | 'Plucks' | 'Basses' | 'Soundtrack FX';
export type ScoringRecipe =
  | 'bow'
  | 'silk'
  | 'glass'
  | 'choir'
  | 'dub'
  | 'mallet'
  | 'sub'
  | 'reed'
  | 'air'
  | 'rise'
  | 'fall'
  | 'pulse'
  | 'glitch'
  | 'metal';
/** Named tuple: each row is an authored timbre, not a random variation. Times are seconds. */
export type ScoringRow = readonly [
  name: string,
  recipe: ScoringRecipe,
  cutoff: number,
  ratio: number,
  index: number,
  attack: number,
  decay: number,
  release: number,
  motionHz: number,
  tags: string,
  note: string,
];
export interface ScoringEntry {
  id: string;
  patch: Patch;
  category: ScoringFamily;
  tags: readonly string[];
  description: string;
}

const E = makeEnvelope;
const HARMONICS = {
  silk: [1, 0.28, 0.12, 0.06, 0.03],
  choir: [1, 0.04, 0.36, 0.08, 0.22, 0.03, 0.09],
  glass: [1, 0, 0.09, 0, 0.2, 0, 0.07, 0, 0.02],
};

function sustained(row: ScoringRow): Patch {
  const [name, recipe, cutoff, ratio, index, attack, decay, release, rate] = row;
  const harmonic = recipe === 'silk' || recipe === 'choir' || recipe === 'glass' ? recipe : null;
  const carrier: PartialOperator = {
    wave: harmonic ? W.USER : W.SAW,
    level: 0.75,
    userKey: harmonic ? `a204-scoring-v1-${harmonic}` : '',
    userPartials: harmonic ? [...HARMONICS[harmonic]] : null,
    env: E({ attackTime: attack, decayTime: decay, sustainLevel: 0.72, releaseTime: release }),
  };
  return makePatch({
    name,
    algorithm: 4,
    volume: 0.25,
    spread: recipe === 'bow' ? 7 : 11,
    ops: [
      carrier,
      {
        ratio,
        level: index,
        env: E({
          attackTime: attack * 1.4,
          decayTime: decay,
          sustainLevel: 0.55,
          releaseTime: release,
        }),
      },
      { ...carrier, detune: -5, level: 0.62, ratio: recipe === 'choir' ? 2 : 1 },
      {
        ratio: ratio * 0.5,
        level: index * 0.7,
        env: E({ attackTime: attack * 0.7, sustainLevel: 0.6, releaseTime: release }),
      },
    ],
    lfo: { shape: L.DRIFT, rate, amount: 1, toPitch: 0.035, toOp: [0.06, 0.25, 0.06, 0.2] },
    filter: {
      mode: recipe === 'choir' ? F.BANDPASS : F.LOWPASS,
      cutoff,
      resonance: 0.85,
      keyTrack: 0.2,
      slope24: true,
      envAmount: 0.8,
      lfoAmount: 0.25,
      env: E({
        attackTime: attack * 1.5,
        decayTime: decay,
        sustainLevel: 0.45,
        releaseTime: release,
      }),
    },
  });
}

function struck(row: ScoringRow): Patch {
  const [name, recipe, cutoff, ratio, index, attack, decay, release, rate] = row;
  const bass = recipe === 'sub' || recipe === 'reed';
  const env = E({
    attackTime: attack,
    decayTime: decay,
    sustainLevel: bass ? 0.38 : 0,
    releaseTime: release,
    decayCurve: 0.65,
  });
  return makePatch({
    name,
    algorithm: recipe === 'dub' ? 4 : 0,
    volume: 0.45,
    mono: bass,
    glide: bass ? 0.035 : 0,
    panRandom: bass ? 0 : 0.08,
    ops: [
      { wave: recipe === 'dub' || recipe === 'reed' ? W.SAW : W.SINE, level: 0.85, env },
      {
        ratio,
        level: index,
        env: E({ ...env, decayTime: decay * 0.4, sustainLevel: bass ? 0.12 : 0 }),
      },
      {
        ratio: recipe === 'dub' ? 1 : 2.01,
        level: recipe === 'dub' ? 0.6 : index * 0.45,
        env: E({ ...env, decayTime: decay * 0.65 }),
      },
      { ratio: 3, level: index * 0.2, env: E({ ...env, decayTime: decay * 0.2 }) },
    ],
    lfo: { shape: L.SINE, rate, amount: 1, toOp: [0, 0.12, 0, 0] },
    filter: {
      mode: F.LOWPASS,
      cutoff,
      resonance: 0.8,
      slope24: recipe !== 'mallet',
      keyTrack: 0.3,
      envAmount: recipe === 'dub' ? 2 : 0.8,
      env: E({
        attackTime: attack,
        decayTime: decay * 0.55,
        sustainLevel: 0,
        releaseTime: release,
      }),
    },
  });
}

function texture(row: ScoringRow): Patch {
  const [name, recipe, cutoff, ratio, index, attack, decay, release, rate] = row;
  const noise = recipe === 'air' || recipe === 'rise' || recipe === 'fall';
  const rising = recipe === 'rise';
  const falling = recipe === 'fall';
  const env = E({
    attackTime: attack,
    decayTime: decay,
    sustainLevel: falling ? 0 : 0.65,
    releaseTime: release,
  });
  return makePatch({
    name,
    algorithm: 0,
    volume: 0.3,
    panRandom: 0.12,
    pitchEnvAmount: rising ? 24 : falling ? 12 : 0,
    pitchEnv: E({
      attackTime: attack,
      decayTime: decay,
      sustainLevel: rising ? 1 : 0,
      releaseTime: release,
    }),
    ops: [
      { wave: noise ? W.NOISE : W.SINE, level: 0.8, env },
      {
        wave: recipe === 'glitch' ? W.SINE_4BIT : W.SINE,
        ratio,
        level: index,
        feedback: recipe === 'metal' ? 0.35 : 0,
        env,
      },
      { ratio: ratio * 1.417, level: index * 0.6, env },
      { wave: rising || falling ? W.SAW : W.SINE, ratio: 0.5, level: index * 0.2, env },
    ],
    lfo: {
      shape: recipe === 'glitch' ? L.SAMPLE_HOLD : recipe === 'pulse' ? L.SQUARE : L.DRIFT,
      rate,
      amount: 1,
      toPitch: recipe === 'glitch' ? 5 : 0,
      toOp: [recipe === 'pulse' ? 1 : 0.12, 0.3, 0.2, 0],
    },
    filter: {
      mode: noise ? F.BANDPASS : F.HIGHPASS,
      cutoff,
      resonance: 1.1,
      keyTrack: 0,
      envAmount: rising ? 4 : falling ? 3 : 0.4,
      lfoAmount: recipe === 'glitch' ? 1.5 : 0.25,
      env: E({
        attackTime: attack,
        decayTime: decay,
        sustainLevel: rising ? 1 : falling ? 0 : 0.4,
        releaseTime: release,
      }),
    },
  });
}

export function scoringEntries(
  category: ScoringFamily,
  rows: readonly ScoringRow[],
): ScoringEntry[] {
  return rows.map((row) => {
    const recipe = row[1];
    const patch = ['bow', 'silk', 'glass', 'choir'].includes(recipe)
      ? sustained(row)
      : ['dub', 'mallet', 'sub', 'reed'].includes(recipe)
        ? struck(row)
        : texture(row);
    return {
      id: `score-${row[0].toLowerCase().replaceAll(' ', '-')}`,
      patch,
      category,
      tags: row[9].split(' '),
      description: row[10],
    };
  });
}
