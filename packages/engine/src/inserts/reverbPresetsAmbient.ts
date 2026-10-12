/**
 * The Ambient group: the long tails and the biggest room.
 * Each preset writes all 17 space fields; Mix and the on/off switch stay the user's
 * (`reverbPresets.ts`). Windsor's own values, voiced by measurement at Mix 1, 48 kHz, through
 * the shipped processor (`docs/research/2026-10-12-reverb-preset-bank/`, `bankRig.mjs`). The
 * aims are the upgrades note's (§8); T30 is broadband, from a click; level is the wet RMS on
 * the pad chord and its tail against Resident's on the same material; peak is the wet peak.
 *
 * | # | Preset | Voicing | Aim | T30 | Level vs Resident | Peak |
 * |---|---|---|---|---|---|---|
 * | 22 | Afters | plate | 6 s | 5.63 s | −0.7 dB | −1.3 dBFS |
 * | 23 | Last Train | plate | 8 s | 7.30 s | −0.8 dB | −1.3 dBFS |
 * | 24 | Comedown | plate | 5 s | 5.09 s | −1.1 dB | −2.1 dBFS |
 * | 25 | Old Mill | room | 4 s | 3.85 s | −1.9 dB | −3.3 dBFS |
 * | 26 | Lights Up | plate | 5 s | 4.73 s | +0.4 dB | −1.6 dBFS |
 * | 27 | Sound System | plate | 4 s | 4.00 s | −1.2 dB | −2.2 dBFS |
 *
 * Old Mill sits at Size 4, the most the room voicing reaches, and is the quietest preset against
 * Resident: at Decay 3.8 s it read 2.6 dB under on the pad with 1 ms of modulation depth and 1.9
 * dB under at 0.2 ms. Build, tank diffusion and the cuts moved it less.
 */
import type { ReverbPreset } from './reverbPresets';

export const AMBIENT_PRESETS: readonly ReverbPreset[] = [
  {
    number: 22,
    label: 'Afters',
    group: 'Ambient',
    settings: {
      preDelay: 0.03,
      inputLowCut: 80,
      inputHighCut: 6000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.15,
      size: 1.4,
      decay: 6,
      lowDecay: 1.1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 60,
      tankHighCut: 4000,
      modRate: 0.4,
      modDepth: 1.2,
      voicing: 'plate',
    },
  },
  {
    number: 23,
    label: 'Last Train',
    group: 'Ambient',
    settings: {
      preDelay: 0.02,
      inputLowCut: 90,
      inputHighCut: 7000,
      diffusionIn1: 0.8,
      diffusionIn2: 0.7,
      build: 0.5,
      size: 1.6,
      decay: 8,
      lowDecay: 1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 100,
      tankHighCut: 5000,
      modRate: 1.4,
      modDepth: 2.2,
      voicing: 'plate',
    },
  },
  {
    number: 24,
    label: 'Comedown',
    group: 'Ambient',
    settings: {
      preDelay: 0.03,
      inputLowCut: 50,
      inputHighCut: 5000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.3,
      size: 1.4,
      decay: 3.8,
      lowDecay: 1.8,
      lowCross: 500,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 30,
      tankHighCut: 3000,
      modRate: 0.3,
      modDepth: 1,
      voicing: 'plate',
    },
  },
  {
    number: 25,
    label: 'Old Mill',
    group: 'Ambient',
    settings: {
      preDelay: 0.04,
      inputLowCut: 60,
      inputHighCut: 8000,
      diffusionIn1: 0.7,
      diffusionIn2: 0.6,
      build: 0,
      size: 4,
      decay: 3.8,
      lowDecay: 1,
      lowCross: 400,
      diffusionTank1: 0.8,
      diffusionTank2: 0.8,
      tankLowCut: 40,
      tankHighCut: 4500,
      modRate: 0.3,
      modDepth: 0.2,
      voicing: 'room',
    },
  },
  {
    number: 26,
    label: 'Lights Up',
    group: 'Ambient',
    settings: {
      preDelay: 0.02,
      inputLowCut: 100,
      inputHighCut: 15000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.5,
      size: 1.2,
      decay: 5,
      lowDecay: 0.9,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 80,
      tankHighCut: 10000,
      modRate: 0.9,
      modDepth: 1.2,
      voicing: 'plate',
    },
  },
  {
    number: 27,
    label: 'Sound System',
    group: 'Ambient',
    settings: {
      preDelay: 0.025,
      inputLowCut: 40,
      inputHighCut: 8000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.2,
      size: 1.6,
      decay: 3.2,
      lowDecay: 2,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 20,
      tankHighCut: 5000,
      modRate: 0.5,
      modDepth: 0.8,
      voicing: 'plate',
    },
  },
];
