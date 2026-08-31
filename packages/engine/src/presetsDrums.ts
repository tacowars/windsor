/**
 * The drum kit. FM percussion: a pitch envelope does the work a sample would.
 *
 * Volumes are measured, not chosen: the headless renderer checks that no preset
 * clips at velocity 1 across MIDI notes 36-84 (`fmProcessor.test.ts`). Operator
 * level, filter drive and resonance interact non-linearly with volume, so after
 * editing any of those, re-measure rather than scaling the volume to match.
 */
import type { Patch } from './patch';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch } from './patch';

const E = makeEnvelope;

export const DRUMS_PRESETS: Record<string, Patch> = {
  kick: makePatch({
    name: 'FM Kick',
    algorithm: 0,
    volume: 1.0,
    pitchEnvAmount: -34,
    pitchEnv: E({
      attackTime: 0.0008,
      peakLevel: 1,
      decayTime: 0.05,
      sustainLevel: 0,
      releaseTime: 0.02,
      decayCurve: 0.92,
    }),
    ops: [
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 1,
        velSens: 0.6,
        env: E({
          attackTime: 0.0008,
          decayTime: 0.32,
          sustainLevel: 0,
          releaseTime: 0.1,
          decayCurve: 0.6,
        }),
      },
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 0.25,
        env: E({ attackTime: 0.0005, decayTime: 0.03, sustainLevel: 0, releaseTime: 0.02 }),
      },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
    ],
    filter: { mode: FILTER_MODE.LOWPASS, cutoff: 3000, drive: 1.5 },
  }),
  snare: makePatch({
    name: 'FM Snare',
    algorithm: 4,
    volume: 1.0,
    ops: [
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 0.7,
        env: E({ attackTime: 0.0008, decayTime: 0.11, sustainLevel: 0, releaseTime: 0.05 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 2.7,
        level: 0.5,
        env: E({ attackTime: 0.0008, decayTime: 0.06, sustainLevel: 0, releaseTime: 0.03 }),
      },
      {
        wave: WAVE.NOISE,
        level: 0.9,
        env: E({
          attackTime: 0.0008,
          decayTime: 0.16,
          sustainLevel: 0,
          releaseTime: 0.06,
          decayCurve: 0.7,
        }),
      },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
    ],
    filter: { mode: FILTER_MODE.HIGHPASS, cutoff: 340, resonance: 1 },
  }),
  hat: makePatch({
    name: 'FM Hat',
    algorithm: 7,
    volume: 1.0,
    ops: [
      {
        wave: WAVE.NOISE,
        level: 0.8,
        env: E({
          attackTime: 0.0005,
          decayTime: 0.05,
          sustainLevel: 0,
          releaseTime: 0.03,
          decayCurve: 0.8,
        }),
      },
      {
        wave: WAVE.SQUARE_D,
        ratio: 11.3,
        level: 0.3,
        env: E({ attackTime: 0.0005, decayTime: 0.04, sustainLevel: 0, releaseTime: 0.02 }),
      },
      {
        wave: WAVE.SQUARE_D,
        ratio: 17.1,
        level: 0.25,
        env: E({ attackTime: 0.0005, decayTime: 0.035, sustainLevel: 0, releaseTime: 0.02 }),
      },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
    ],
    filter: { mode: FILTER_MODE.HIGHPASS, cutoff: 6500, resonance: 1.2 },
  }),
};
