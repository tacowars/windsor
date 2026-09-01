/**
 * Melodic instruments -- the voices an arrangement is written for.
 *
 * Volumes are measured, not chosen: the headless renderer checks that no preset
 * clips at velocity 1 across MIDI notes 36-84 (`fmProcessor.test.ts`). Operator
 * level, filter drive and resonance interact non-linearly with volume, so after
 * editing any of those, re-measure rather than scaling the volume to match.
 */
import type { Patch } from './patch';
import { FILTER_MODE, LFO_SHAPE, WAVE, makeEnvelope, makePatch } from './patch';

const E = makeEnvelope;

export const MUSIC_PRESETS: Record<string, Patch> = {
  'lead-bell': makePatch({
    name: 'Bell Lead',
    algorithm: 0,
    volume: 0.97,
    ops: [
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 1.0,
        env: E({
          attackTime: 0.001,
          decayTime: 2.2,
          sustainLevel: 0,
          releaseTime: 0.8,
          decayCurve: 0.8,
        }),
      },
      {
        wave: WAVE.SINE,
        ratio: 3.5,
        level: 0.55,
        env: E({
          attackTime: 0.001,
          decayTime: 1.1,
          sustainLevel: 0,
          releaseTime: 0.4,
          decayCurve: 0.9,
        }),
      },
      {
        wave: WAVE.SINE,
        ratio: 7,
        level: 0.2,
        env: E({ attackTime: 0.001, decayTime: 0.35, sustainLevel: 0, releaseTime: 0.2 }),
      },
      { wave: WAVE.SINE, ratio: 1, level: 0 },
    ],
    filter: { mode: FILTER_MODE.LOWPASS, cutoff: 6000, keyTrack: 0.5 },
  }),
  'pad-drift': makePatch({
    name: 'Drift Pad',
    algorithm: 4,
    volume: 0.44,
    spread: 12,
    ops: [
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 0.9,
        env: E({
          attackTime: 1.2,
          decayTime: 2,
          sustainLevel: 0.8,
          releaseTime: 2.4,
          attackCurve: -0.3,
        }),
      },
      {
        wave: WAVE.TRIANGLE,
        ratio: 2.01,
        level: 0.35,
        env: E({ attackTime: 2.5, decayTime: 3, sustainLevel: 0.5, releaseTime: 2.4 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 1.5,
        level: 0.7,
        env: E({ attackTime: 1.8, decayTime: 2, sustainLevel: 0.7, releaseTime: 2.4 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 4,
        level: 0.25,
        env: E({ attackTime: 3.5, decayTime: 4, sustainLevel: 0.4, releaseTime: 2.4 }),
      },
    ],
    lfo: { shape: LFO_SHAPE.DRIFT, rate: 0.18, amount: 1, toPitch: 0.12, toOp: [0, 0.25, 0, 0.3] },
    filter: {
      mode: FILTER_MODE.LOWPASS,
      cutoff: 1400,
      resonance: 1.2,
      envAmount: 1.8,
      slope24: true,
      env: E({ attackTime: 3, decayTime: 5, sustainLevel: 0.5, releaseTime: 3 }),
    },
  }),
  'ai-voice': makePatch({
    name: 'AI Voice',
    algorithm: 10,
    volume: 0.66,
    glide: 0.06,
    ops: [
      {
        wave: WAVE.SAW,
        ratio: 1,
        level: 0.85,
        env: E({ attackTime: 0.05, decayTime: 0.3, sustainLevel: 0.85, releaseTime: 0.25 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 2,
        level: 0.28,
        fixed: false,
        env: E({ attackTime: 0.08, sustainLevel: 0.6, releaseTime: 0.2 }),
      },
      {
        wave: WAVE.SINE,
        fixed: true,
        fixedHz: 740,
        level: 0.22,
        env: E({ attackTime: 0.03, sustainLevel: 0.5, releaseTime: 0.2 }),
      },
      {
        wave: WAVE.SINE,
        fixed: true,
        fixedHz: 1180,
        level: 0.14,
        env: E({ attackTime: 0.12, sustainLevel: 0.4, releaseTime: 0.2 }),
      },
    ],
    lfo: { shape: LFO_SHAPE.SINE, rate: 4.6, amount: 1, delay: 0.35, toPitch: 0.09 },
    filter: {
      mode: FILTER_MODE.BANDPASS,
      cutoff: 900,
      resonance: 3.5,
      keyTrack: 0.4,
      envAmount: 0.8,
      env: E({ attackTime: 0.06, decayTime: 0.5, sustainLevel: 0.6, releaseTime: 0.3 }),
    },
  }),
  'sub-drone': makePatch({
    name: 'Sub Drone',
    algorithm: 6,
    volume: 1.0,
    ops: [
      {
        wave: WAVE.SINE,
        ratio: 0.5,
        level: 1,
        env: E({ attackTime: 0.8, sustainLevel: 1, releaseTime: 1.5 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 0.3,
        env: E({ attackTime: 2, sustainLevel: 0.6, releaseTime: 1.5 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 1.005,
        level: 0.12,
        env: E({ attackTime: 1, sustainLevel: 0.8, releaseTime: 1.5 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 3,
        level: 0.06,
        env: E({ attackTime: 4, sustainLevel: 0.5, releaseTime: 1.5 }),
      },
    ],
    lfo: { shape: LFO_SHAPE.SINE, rate: 0.07, amount: 1, toOp: [0.12, 0, 0, 0] },
    filter: { mode: FILTER_MODE.LOWPASS, cutoff: 320, resonance: 0.8, slope24: true },
  }),
  'bass-digital': makePatch({
    name: 'Digital Bass',
    algorithm: 3,
    volume: 0.14,
    ops: [
      {
        wave: WAVE.SAW_D,
        ratio: 1,
        level: 1,
        env: E({ attackTime: 0.002, decayTime: 0.6, sustainLevel: 0.55, releaseTime: 0.15 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 1,
        level: 0.45,
        env: E({ attackTime: 0.001, decayTime: 0.25, sustainLevel: 0.2, releaseTime: 0.12 }),
      },
      {
        wave: WAVE.SINE,
        ratio: 2,
        level: 0.4,
        env: E({ attackTime: 0.001, decayTime: 0.18, sustainLevel: 0.1, releaseTime: 0.1 }),
      },
      {
        wave: WAVE.SQUARE,
        ratio: 4,
        level: 0.3,
        env: E({ attackTime: 0.001, decayTime: 0.09, sustainLevel: 0, releaseTime: 0.1 }),
      },
    ],
    tone: 0.7,
    filter: {
      mode: FILTER_MODE.LOWPASS,
      cutoff: 700,
      resonance: 2.4,
      drive: 1.6,
      envAmount: 2.5,
      slope24: true,
      env: E({
        attackTime: 0.001,
        decayTime: 0.3,
        sustainLevel: 0.15,
        releaseTime: 0.15,
        decayCurve: 0.7,
      }),
    },
  }),
};
