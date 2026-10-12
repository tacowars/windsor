/**
 * The Everyday group: the presets to reach for first, Resident (the default) at their head.
 * Each preset writes all 17 space fields; Mix and the on/off switch stay the user's
 * (`reverbPresets.ts`). Windsor's own values, voiced by measurement at Mix 1, 48 kHz, through
 * the shipped processor (`docs/research/2026-10-12-reverb-preset-bank/`, `bankRig.mjs`). The
 * aims are the upgrades note's (§8); T30 is broadband, from a click; level is the wet RMS on
 * the drum loop and its tail against Resident's on the same material; peak is the wet peak.
 *
 * | # | Preset | Voicing | Aim | T30 | Level vs Resident | Peak |
 * |---|---|---|---|---|---|---|
 * | 1 | Resident | plate | 6.35 s | 6.03 s | +0.0 dB | −11.6 dBFS |
 * | 2 | House Plate | plate | 1.6 s | 1.54 s | +0.7 dB | −12.0 dBFS |
 * | 3 | Main Room | room | 1 s | 1.02 s | +0.6 dB | −13.9 dBFS |
 * | 4 | Back Room | room | 0.6 s | 0.58 s | +0.9 dB | −12.2 dBFS |
 * | 5 | Warm-up | plate | 1.1 s | 1.06 s | −0.6 dB | −14.2 dBFS |
 * | 6 | Booth | room | 0.35 s | 0.33 s | −0.8 dB | −10.2 dBFS |
 * | 7 | Mic Check | plate | 1 s | 0.96 s | −0.3 dB | −11.5 dBFS |
 * | 8 | Long Set | plate | 3 s | 2.84 s | −0.5 dB | −12.5 dBFS |
 *
 * Resident is today's `hall` space field for field, so its aim is that space's own tail: its
 * Decay, 6.35 s, is the T30 `hall` measured before Decay became seconds (windsor#748), and through
 * today's processor it measures 6.03 s.
 */
import type { ReverbPreset } from './reverbPresets';

export const EVERYDAY_PRESETS: readonly ReverbPreset[] = [
  {
    number: 1,
    label: 'Resident',
    group: 'Everyday',
    settings: {
      preDelay: 0.025,
      inputLowCut: 60,
      inputHighCut: 10000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.1,
      size: 1.4,
      decay: 6.35,
      lowDecay: 1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 60,
      tankHighCut: 6500,
      modRate: 0.5,
      modDepth: 0.8,
      voicing: 'plate',
    },
  },
  {
    number: 2,
    label: 'House Plate',
    group: 'Everyday',
    settings: {
      preDelay: 0.01,
      inputLowCut: 80,
      inputHighCut: 12000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.1,
      size: 0.6,
      decay: 1.6,
      lowDecay: 1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 80,
      tankHighCut: 7500,
      modRate: 0.8,
      modDepth: 0.5,
      voicing: 'plate',
    },
  },
  {
    number: 3,
    label: 'Main Room',
    group: 'Everyday',
    settings: {
      preDelay: 0.008,
      inputLowCut: 100,
      inputHighCut: 11000,
      diffusionIn1: 0.7,
      diffusionIn2: 0.6,
      build: 0.15,
      size: 0.8,
      decay: 1,
      lowDecay: 1.1,
      lowCross: 500,
      diffusionTank1: 0.5,
      diffusionTank2: 0.4,
      tankLowCut: 80,
      tankHighCut: 7000,
      modRate: 0.5,
      modDepth: 0.3,
      voicing: 'room',
    },
  },
  {
    number: 4,
    label: 'Back Room',
    group: 'Everyday',
    settings: {
      preDelay: 0.006,
      inputLowCut: 150,
      inputHighCut: 10000,
      diffusionIn1: 0.65,
      diffusionIn2: 0.55,
      build: 0.1,
      size: 0.4,
      decay: 0.6,
      lowDecay: 1,
      lowCross: 400,
      diffusionTank1: 0.5,
      diffusionTank2: 0.4,
      tankLowCut: 150,
      tankHighCut: 6000,
      modRate: 0.4,
      modDepth: 0.3,
      voicing: 'room',
    },
  },
  {
    number: 5,
    label: 'Warm-up',
    group: 'Everyday',
    settings: {
      preDelay: 0.01,
      inputLowCut: 100,
      inputHighCut: 5000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.1,
      size: 0.7,
      decay: 1.1,
      lowDecay: 1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 100,
      tankHighCut: 4000,
      modRate: 0.6,
      modDepth: 0.5,
      voicing: 'plate',
    },
  },
  {
    number: 6,
    label: 'Booth',
    group: 'Everyday',
    settings: {
      preDelay: 0.002,
      inputLowCut: 150,
      inputHighCut: 12000,
      diffusionIn1: 0.6,
      diffusionIn2: 0.5,
      build: 0,
      size: 0.15,
      decay: 0.35,
      lowDecay: 1,
      lowCross: 400,
      diffusionTank1: 0.4,
      diffusionTank2: 0.3,
      tankLowCut: 150,
      tankHighCut: 8000,
      modRate: 0.3,
      modDepth: 0.15,
      voicing: 'room',
    },
  },
  {
    number: 7,
    label: 'Mic Check',
    group: 'Everyday',
    settings: {
      preDelay: 0.02,
      inputLowCut: 100,
      inputHighCut: 10000,
      diffusionIn1: 0.4,
      diffusionIn2: 0.35,
      build: 0.15,
      size: 0.5,
      decay: 1,
      lowDecay: 1.1,
      lowCross: 400,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 80,
      tankHighCut: 5000,
      modRate: 0.8,
      modDepth: 0.5,
      voicing: 'plate',
    },
  },
  {
    number: 8,
    label: 'Long Set',
    group: 'Everyday',
    settings: {
      preDelay: 0.015,
      inputLowCut: 80,
      inputHighCut: 10000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.1,
      size: 1.1,
      decay: 3,
      lowDecay: 1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 80,
      tankHighCut: 6000,
      modRate: 0.6,
      modDepth: 0.7,
      voicing: 'plate',
    },
  },
];
