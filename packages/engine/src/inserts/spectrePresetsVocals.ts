/**
 * Spectre's Vocals & leads presets (record `2026-10-17-spectre-drawn-cells`
 * decision 12): smears, splits and climbs on a sung or played line.
 * Windsor's own values; each preset shows one idea, named in the bank's
 * register.
 *
 * Measured at Mix 1, 48 kHz, on the sung line with 2 s of tail
 * (`docs/research/2026-10-17-spectre-workbench/presetRig.ts`): wet RMS, its
 * distance from the group's first (the level rule: within ±2 dB), and peak.
 *
 *   Hype Man           -24.1 dBFS    0.0 dB  peak   -8.5
 *   Tannoy             -25.5 dBFS   -1.4 dB  peak   -9.5
 *   Diva Melt          -24.2 dBFS   -0.0 dB  peak   -8.4
 *   Riser              -23.8 dBFS    0.4 dB  peak   -9.5
 *   Anthem             -23.7 dBFS    0.4 dB  peak   -8.4
 *   Whistle Posse      -24.1 dBFS   -0.0 dB  peak   -8.3
 */
import type { SpectrePreset } from './spectrePresetBase';
import { spectrePreset } from './spectrePresetBase';
import { band, comb, flat, linked, ramp, steps, trim, unlinked, within } from './spectreRecipes';

/* eslint-disable no-magic-numbers -- preset tables: each number is a voiced setting, read with its preset */
export const SPECTRE_PRESETS_VOCALS: readonly SpectrePreset[] = [
  {
    number: 7,
    label: 'Hype Man',
    group: 'Vocals & leads',
    // Delays rising smoothly from none to a beat: a word climbs through its overtones.
    settings: spectrePreset({
      division: '1/4',
      grid: 'off',
      curves: {
        gain: linked(trim(flat(1), -2)),
        delay: linked(ramp(0, 1)),
        feedback: linked(flat(0.3)),
      },
    }),
  },
  {
    number: 8,
    label: 'Tannoy',
    group: 'Vocals & leads',
    // A narrow band around the voice's middle over short, combed delays: a PA in a hall.
    settings: spectrePreset({
      sync: false,
      timeMs: 160,
      grid: 'off',
      curves: {
        gain: linked(band(700, 3500, 1, 0.6)),
        delay: linked(comb(0.25, 0.5, 0.2), true),
        feedback: linked(band(700, 3500, 0.6, 0.2)),
      },
    }),
  },
  {
    number: 9,
    label: 'Diva Melt',
    group: 'Vocals & leads',
    // Long, smooth delays on the mids, blurred with a phase jitter: a sung line smears into a chord.
    settings: spectrePreset({
      division: '1/1',
      grid: 'off',
      mod: 'blur',
      modA: 0.6,
      modB: 0.35,
      modC: 0.4,
      curves: {
        gain: linked(flat(1)),
        delay: linked(within(band(250, 4000, 1, 0), ramp(0.35, 0.65), flat(0.08))),
        feedback: linked(band(250, 4000, 0.62, 0.2)),
      },
    }),
  },
  {
    number: 10,
    label: 'Riser',
    group: 'Vocals & leads',
    // Shifted up as it repeats, with the LFO sliding the delay curve upward bar by bar.
    settings: spectrePreset({
      division: '1/2',
      grid: 'off',
      mod: 'shift',
      modA: 0.6,
      lfoShape: 'saw',
      lfoSync: true,
      lfoDivision: '1/1',
      lfoDest1: 'delayShift',
      lfoDepth1: 0.35,
      curves: {
        gain: linked(trim(flat(1), -3.5)),
        delay: linked(ramp(0.1, 0.45)),
        feedback: linked(flat(0.5)),
      },
    }),
  },
  {
    number: 11,
    label: 'Anthem',
    group: 'Vocals & leads',
    // Left and right apart: one delay ramp rising, the other falling, so the line splits across the field.
    settings: spectrePreset({
      division: '1/2',
      grid: '1/16',
      curves: {
        gain: linked(trim(flat(1), -3)),
        delay: unlinked(ramp(0.05, 0.6), ramp(0.6, 0.05)),
        feedback: linked(flat(0.35)),
      },
    }),
  },
  {
    number: 12,
    label: 'Whistle Posse',
    group: 'Vocals & leads',
    // Only the bands above 1 kHz, delayed in steps with high feedback: the brightness echoes on its own.
    settings: spectrePreset({
      division: '1/2',
      grid: '1/8',
      curves: {
        gain: linked(band(1000, 20000, 1, 0.82)),
        delay: linked(steps(1000, 20000, [0.25, 0.5, 0.75], 0), true),
        feedback: linked(band(1000, 20000, 0.85, 0)),
      },
    }),
  },
];
