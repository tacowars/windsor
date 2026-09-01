/**
 * Game event sounds, serving the readability rule in the design doc (GDD 5.3):
 * distinct silhouettes want distinct audio, and these are the tells.
 *
 * Volumes are measured, not chosen: the headless renderer checks that no preset
 * clips at velocity 1 across MIDI notes 36-84 (`fmProcessor.test.ts`). Operator
 * level, filter drive and resonance interact non-linearly with volume, so after
 * editing any of those, re-measure rather than scaling the volume to match.
 */
import type { Patch } from './patch';
import { FILTER_MODE, LFO_SHAPE, WAVE, makeEnvelope, makePatch } from './patch';

const E = makeEnvelope;

export const SFX_PRESETS: Record<string, Patch> = {
  'weapon-zap': makePatch({
    name: 'Weapon Zap',
    algorithm: 1,
    volume: 0.45,
    pitchEnvAmount: -26,
    pitchEnv: E({
      attackTime: 0.001,
      peakLevel: 1,
      decayTime: 0.11,
      sustainLevel: 0,
      releaseTime: 0.05,
      decayCurve: 0.85,
    }),
    ops: [
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 1,
        env: E({ attackTime: 0.001, decayTime: 0.16, sustainLevel: 0, releaseTime: 0.05 }),
      },
      {
        wave: WAVE.SAW,
        ratio: 2.4,
        level: 0.6,
        env: E({ attackTime: 0.001, decayTime: 0.09, sustainLevel: 0, releaseTime: 0.04 }),
      },
      {
        wave: WAVE.NOISE,
        level: 0.35,
        env: E({ attackTime: 0.001, decayTime: 0.05, sustainLevel: 0, releaseTime: 0.03 }),
      },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
    ],
    filter: {
      mode: FILTER_MODE.BANDPASS,
      cutoff: 2400,
      resonance: 3,
      envAmount: 3,
      env: E({ attackTime: 0.001, decayTime: 0.12, sustainLevel: 0, releaseTime: 0.05 }),
    },
  }),
  'horde-horn': makePatch({
    name: 'Horde Horn',
    algorithm: 1,
    volume: 0.23,
    glide: 0.25,
    ops: [
      {
        wave: WAVE.SAW,
        ratio: 0.5,
        level: 1,
        env: E({
          attackTime: 0.4,
          decayTime: 1,
          sustainLevel: 0.9,
          releaseTime: 1.2,
          attackCurve: -0.4,
        }),
      },
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 0.5,
        env: E({ attackTime: 0.9, sustainLevel: 0.7, releaseTime: 1 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 1.007,
        level: 0.4,
        env: E({ attackTime: 1.2, sustainLevel: 0.6, releaseTime: 1 }),
      },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
    ],
    spread: 9,
    lfo: { shape: LFO_SHAPE.SINE, rate: 3.1, amount: 1, delay: 0.8, toPitch: 0.14 },
    filter: {
      mode: FILTER_MODE.LOWPASS,
      cutoff: 1100,
      resonance: 1.6,
      envAmount: 1.4,
      drive: 1.4,
      slope24: true,
      env: E({ attackTime: 0.6, decayTime: 2, sustainLevel: 0.7, releaseTime: 1 }),
    },
  }),
  'pickup-blip': makePatch({
    name: 'Pickup Blip',
    algorithm: 0,
    volume: 1.0,
    pitchEnvAmount: 12,
    pitchEnv: E({
      attackTime: 0.04,
      peakLevel: 1,
      decayTime: 0.01,
      sustainLevel: 1,
      releaseTime: 0.01,
    }),
    ops: [
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 1,
        env: E({ attackTime: 0.002, decayTime: 0.14, sustainLevel: 0, releaseTime: 0.06 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 4,
        level: 0.35,
        env: E({ attackTime: 0.001, decayTime: 0.07, sustainLevel: 0, releaseTime: 0.04 }),
      },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
    ],
  }),
  'build-thunk': makePatch({
    name: 'Build Thunk',
    algorithm: 2,
    volume: 0.89,
    pitchEnvAmount: -18,
    pitchEnv: E({
      attackTime: 0.001,
      peakLevel: 1,
      decayTime: 0.07,
      sustainLevel: 0,
      releaseTime: 0.02,
      decayCurve: 0.9,
    }),
    ops: [
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 1,
        env: E({ attackTime: 0.001, decayTime: 0.22, sustainLevel: 0, releaseTime: 0.08 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 1.41,
        level: 0.5,
        env: E({ attackTime: 0.001, decayTime: 0.1, sustainLevel: 0, releaseTime: 0.05 }),
      },
      {
        wave: WAVE.NOISE,
        level: 0.5,
        env: E({ attackTime: 0.001, decayTime: 0.04, sustainLevel: 0, releaseTime: 0.02 }),
      },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
    ],
    filter: {
      mode: FILTER_MODE.LOWPASS,
      cutoff: 1800,
      resonance: 1.1,
      envAmount: 2,
      drive: 1.3,
      env: E({ attackTime: 0.001, decayTime: 0.15, sustainLevel: 0, releaseTime: 0.05 }),
    },
  }),
};
