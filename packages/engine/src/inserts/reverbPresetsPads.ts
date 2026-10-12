/**
 * The Pads & leads group: plates that swell, shine and bloom under chords and lines.
 * Each preset writes all 17 space fields; Mix and the on/off switch stay the user's
 * (`reverbPresets.ts`). Windsor's own values, voiced by measurement at Mix 1, 48 kHz, through
 * the shipped processor (`docs/research/2026-10-12-reverb-preset-bank/`, `bankRig.mjs`). The
 * aims are the upgrades note's (§8); T30 is broadband, from a click; level is the wet RMS on
 * the pad chord and its tail against Resident's on the same material; peak is the wet peak.
 *
 * | # | Preset | Voicing | Aim | T30 | Level vs Resident | Peak |
 * |---|---|---|---|---|---|---|
 * | 16 | Acetate | plate | 1.8 s | 1.76 s | +1.7 dB | −3.1 dBFS |
 * | 17 | White Label | plate | 2.5 s | 2.34 s | +0.8 dB | −2.6 dBFS |
 * | 18 | Euphoria | plate | 3.5 s | 3.42 s | −0.6 dB | −3.3 dBFS |
 * | 19 | Hands in the Air | plate | 4 s | 3.85 s | +0.5 dB | −2.5 dBFS |
 * | 20 | Breakdown | plate | 3 s | 2.98 s | −1.0 dB | −3.0 dBFS |
 * | 21 | Sunrise Set | plate | 4 s | 4.00 s | −0.2 dB | −1.0 dBFS |
 */
import type { ReverbPreset } from './reverbPresets';

export const PADS_PRESETS: readonly ReverbPreset[] = [
  {
    number: 16,
    label: 'Acetate',
    group: 'Pads & leads',
    settings: {
      preDelay: 0.005,
      inputLowCut: 80,
      inputHighCut: 12000,
      diffusionIn1: 0.6,
      diffusionIn2: 0.5,
      build: 0.5,
      size: 0.6,
      decay: 1.8,
      lowDecay: 1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 60,
      tankHighCut: 9000,
      modRate: 0.7,
      modDepth: 0.6,
      voicing: 'plate',
    },
  },
  {
    number: 17,
    label: 'White Label',
    group: 'Pads & leads',
    settings: {
      preDelay: 0.012,
      inputLowCut: 200,
      inputHighCut: 16000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.1,
      size: 0.8,
      decay: 2.5,
      lowDecay: 0.8,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 200,
      tankHighCut: 12000,
      modRate: 0.8,
      modDepth: 0.3,
      voicing: 'plate',
    },
  },
  {
    number: 18,
    label: 'Euphoria',
    group: 'Pads & leads',
    settings: {
      preDelay: 0.015,
      inputLowCut: 80,
      inputHighCut: 11000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.2,
      size: 1.3,
      decay: 3.5,
      lowDecay: 1.1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 60,
      tankHighCut: 7500,
      modRate: 1.2,
      modDepth: 1.8,
      voicing: 'plate',
    },
  },
  {
    number: 19,
    label: 'Hands in the Air',
    group: 'Pads & leads',
    settings: {
      preDelay: 0.01,
      inputLowCut: 100,
      inputHighCut: 12000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.9,
      size: 1.5,
      decay: 4,
      lowDecay: 1,
      lowCross: 300,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 80,
      tankHighCut: 8000,
      modRate: 0.8,
      modDepth: 1,
      voicing: 'plate',
    },
  },
  {
    number: 20,
    label: 'Breakdown',
    group: 'Pads & leads',
    settings: {
      preDelay: 0.01,
      inputLowCut: 80,
      inputHighCut: 6000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.8,
      size: 1.2,
      decay: 3,
      lowDecay: 1.2,
      lowCross: 400,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 60,
      tankHighCut: 4000,
      modRate: 0.6,
      modDepth: 0.9,
      voicing: 'plate',
    },
  },
  {
    number: 21,
    label: 'Sunrise Set',
    group: 'Pads & leads',
    settings: {
      preDelay: 0.02,
      inputLowCut: 60,
      inputHighCut: 9000,
      diffusionIn1: 0.75,
      diffusionIn2: 0.625,
      build: 0.3,
      size: 1,
      decay: 3.6,
      lowDecay: 1.4,
      lowCross: 600,
      diffusionTank1: 0.7,
      diffusionTank2: 0.5,
      tankLowCut: 40,
      tankHighCut: 6000,
      modRate: 0.5,
      modDepth: 0.9,
      voicing: 'plate',
    },
  },
];
