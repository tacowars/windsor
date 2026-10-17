/**
 * Spectre's Freeze & FX presets (record `2026-10-17-spectre-drawn-cells`
 * decision 12): holding, carving, scattering and sweeping. Windsor's own
 * values; each preset shows one idea, named in the bank's register. Freeze's
 * switch stays the user's: these set its mode and what it holds.
 *
 * Measured at Mix 1, 48 kHz, on the drum loop with 2 s of tail
 * (`docs/research/2026-10-17-spectre-workbench/presetRig.ts`): wet RMS, its
 * distance from the group's first (the level rule: within ±2 dB), and peak.
 *
 *   Freeze Frame       -24.4 dBFS    0.0 dB  peak   -5.4
 *   Tunnel Vision      -24.7 dBFS   -0.3 dB  peak   -9.9
 *   Mashed Up          -22.9 dBFS    1.5 dB  peak   -3.6
 *   Sweep the Floor    -25.8 dBFS   -1.4 dB  peak   -5.7
 *   Flashback          -23.7 dBFS    0.7 dB  peak   -5.8
 *   Rinse Out          -25.1 dBFS   -0.7 dB  peak   -5.5
 */
import type { SpectrePreset } from './spectrePresetBase';
import { spectrePreset } from './spectrePresetBase';
import { band, comb, flat, linked, ramp, scatter, trim } from './spectreRecipes';

/* eslint-disable no-magic-numbers -- preset tables: each number is a voiced setting, read with its preset */
export const SPECTRE_PRESETS_FREEZE: readonly SpectrePreset[] = [
  {
    number: 19,
    label: 'Freeze Frame',
    group: 'Freeze & FX',
    // A steady map of delays to catch a moment in: press Freeze to hold it.
    settings: spectrePreset({
      division: '1/2',
      grid: '1/16',
      freezeMode: 'hold',
      curves: {
        gain: linked(trim(flat(1), -4.5)),
        delay: linked(scatter(0xf0f0, 0.2, 0.6), true),
        feedback: linked(flat(0.5)),
      },
    }),
  },
  {
    number: 20,
    label: 'Tunnel Vision',
    group: 'Freeze & FX',
    // Carve keeps the drawn feedback: frozen, the notched bands fall away and the sound narrows to a tunnel.
    settings: spectrePreset({
      division: '1/4',
      grid: 'off',
      freezeMode: 'carve',
      curves: {
        gain: linked(trim(flat(1), -12.5)),
        delay: linked(flat(0.25)),
        feedback: linked(comb(1, 0.96, 0.5, 0.7), true),
      },
    }),
  },
  {
    number: 21,
    label: 'Mashed Up',
    group: 'Freeze & FX',
    // Random cells, no grid and the scatter up: the order comes apart.
    settings: spectrePreset({
      division: '1/2',
      grid: 'off',
      scatter: 0.6,
      curves: {
        gain: linked(trim(flat(1), -1)),
        delay: linked(scatter(0xbad5eed, 0, 1), true),
        feedback: linked(scatter(0x5eedbad, 0.3, 0.7), true),
      },
    }),
  },
  {
    number: 22,
    label: 'Sweep the Floor',
    group: 'Freeze & FX',
    // Two LFO slots synced to a bar, sliding the delay and gain curves together.
    settings: spectrePreset({
      division: '1/2',
      grid: 'off',
      lfoShape: 'sine',
      lfoSync: true,
      lfoDivision: '1/1',
      lfoDest1: 'delayShift',
      lfoDepth1: 0.5,
      lfoDest2: 'gainShift',
      lfoDepth2: 0.5,
      curves: {
        gain: linked(band(100, 6000, 1, 0.9)),
        delay: linked(ramp(0.1, 0.4)),
        feedback: linked(flat(0.5)),
      },
    }),
  },
  {
    number: 23,
    label: 'Flashback',
    group: 'Freeze & FX',
    // Delays falling with frequency and fed back: each hit cascades downward.
    settings: spectrePreset({
      division: '1/2',
      grid: 'off',
      curves: {
        gain: linked(trim(flat(1), -2.5)),
        delay: linked(ramp(0.8, 0.1)),
        feedback: linked(flat(0.55)),
      },
    }),
  },
  {
    number: 24,
    label: 'Rinse Out',
    group: 'Freeze & FX',
    // Invert and stepped feedback over sixteenth-note delays: harsh and torn.
    settings: spectrePreset({
      division: '1/4',
      grid: '1/16',
      mod: 'invert',
      modA: 0.5,
      modB: 0.8,
      curves: {
        gain: linked(flat(1)),
        delay: linked(scatter(0x7a7a, 0.25, 1), true),
        feedback: linked(comb(0.4, 0.85, 0.4), true),
      },
    }),
  },
];
