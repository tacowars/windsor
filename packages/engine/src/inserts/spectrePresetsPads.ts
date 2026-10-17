/**
 * Spectre's Pads & textures presets (record `2026-10-17-spectre-drawn-cells`
 * decision 12): combs, sieves, resonances and rooms on sustained sound.
 * Windsor's own values; each preset shows one idea, named in the bank's
 * register.
 *
 * Measured at Mix 1, 48 kHz, on the pad chord with 2 s of tail
 * (`docs/research/2026-10-17-spectre-workbench/presetRig.ts`): wet RMS, its
 * distance from the group's first (the level rule: within ±2 dB), and peak.
 *
 *   Prism              -25.3 dBFS    0.0 dB  peak   -8.7
 *   Ring Road          -25.0 dBFS    0.3 dB  peak   -9.5
 *   Lava Lamp          -24.5 dBFS    0.8 dB  peak   -9.2
 *   Smiley             -24.5 dBFS    0.8 dB  peak   -9.8
 *   Warehouse          -25.2 dBFS    0.1 dB  peak   -9.0
 *   Dub Siren          -26.0 dBFS   -0.7 dB  peak   -9.0
 */
import type { SpectrePreset } from './spectrePresetBase';
import { spectrePreset } from './spectrePresetBase';
import { band, comb, flat, linked, ramp, sieve, trim } from './spectreRecipes';

/* eslint-disable no-magic-numbers -- preset tables: each number is a voiced setting, read with its preset */
export const SPECTRE_PRESETS_PADS: readonly SpectrePreset[] = [
  {
    number: 13,
    label: 'Prism',
    group: 'Pads & textures',
    // A gain comb a third of an octave wide, slid slowly by the LFO: a spectral phaser.
    settings: spectrePreset({
      grid: 'off',
      lfoShape: 'sine',
      lfoHz: 0.12,
      lfoDest1: 'gainShift',
      lfoDepth1: 0.25,
      curves: {
        gain: linked(comb(1 / 3, 1, 0.45)),
        delay: linked(flat(0)),
        feedback: linked(flat(0)),
      },
    }),
  },
  {
    number: 14,
    label: 'Ring Road',
    group: 'Pads & textures',
    // Very short delays in a comb of high feedback: a metallic ring in tune with nothing.
    settings: spectrePreset({
      sync: false,
      timeMs: 60,
      grid: 'off',
      bands: '1024',
      curves: {
        gain: linked(trim(flat(1), -3.5)),
        delay: linked(comb(0.15, 0.6, 0.2), true),
        feedback: linked(comb(0.15, 0.85, 0.5), true),
      },
    }),
  },
  {
    number: 15,
    label: 'Lava Lamp',
    group: 'Pads & textures',
    // Swell over the bands, the LFO breathing the feedback in and out.
    settings: spectrePreset({
      division: '1/2',
      grid: 'off',
      mod: 'swell',
      modA: 0.55,
      modB: 0.3,
      modC: 0.5,
      lfoShape: 'sine',
      lfoHz: 0.08,
      lfoDest1: 'feedbackOffset',
      lfoDepth1: 0.25,
      curves: {
        gain: linked(flat(1)),
        delay: linked(ramp(0.2, 0.5)),
        feedback: linked(flat(0.45)),
      },
    }),
  },
  {
    number: 16,
    label: 'Smiley',
    group: 'Pads & textures',
    // A sieve of gain cells over the smudge: a shimmer with gaps in it.
    settings: spectrePreset({
      division: '1/2',
      grid: 'off',
      mod: 'smudge',
      modA: 0.5,
      modB: 0.6,
      curves: {
        gain: linked(sieve(0x51e7e, 0.6, 1, 0.15), true),
        delay: linked(ramp(0.1, 0.4)),
        feedback: linked(flat(0.4)),
      },
    }),
  },
  {
    number: 17,
    label: 'Warehouse',
    group: 'Pads & textures',
    // Low bands long and fed back, highs cut and short: a big, dark room.
    settings: spectrePreset({
      division: '1/1',
      grid: 'off',
      bands: '1024',
      curves: {
        gain: linked(trim(band(20, 4000, 1, 0.6), -3.5)),
        delay: linked(ramp(0.8, 0.15)),
        feedback: linked(ramp(0.75, 0.2)),
      },
    }),
  },
  {
    number: 18,
    label: 'Dub Siren',
    group: 'Pads & textures',
    // The shift modulation with feedback near full: tones spiral up out of the sound.
    settings: spectrePreset({
      division: '1/2',
      grid: '1/8',
      mod: 'shift',
      modA: 0.58,
      curves: {
        gain: linked(trim(flat(1), -5)),
        delay: linked(flat(0.25)),
        feedback: linked(flat(0.85)),
      },
    }),
  },
];
