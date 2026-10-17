/**
 * Spectre's Drums presets (record `2026-10-17-spectre-drawn-cells` decision
 * 12): the delay grid and the gate on loops and hits. Windsor's own values;
 * each preset shows one idea, named in the bank's register.
 *
 * Measured at Mix 1, 48 kHz, on the drum loop with 2 s of tail
 * (`docs/research/2026-10-17-spectre-workbench/presetRig.ts`): wet RMS, its
 * distance from the group's first (the level rule: within ±2 dB), and peak.
 *
 *   Bleep Test         -23.6 dBFS    0.0 dB  peak   -1.9
 *   Hardcore Roll      -23.3 dBFS    0.3 dB  peak   -5.2
 *   Shuffle Floor      -23.3 dBFS    0.3 dB  peak   -4.1
 *   Speaker Stack      -23.5 dBFS    0.1 dB  peak   -3.7
 *   Jungle Splice      -23.4 dBFS    0.2 dB  peak   -3.3
 *   Bass Bin           -24.3 dBFS   -0.7 dB  peak   -4.7
 */
import type { SpectrePreset } from './spectrePresetBase';
import { spectrePreset } from './spectrePresetBase';
import { band, comb, flat, linked, ramp, steps, trim, within } from './spectreRecipes';

/* eslint-disable no-magic-numbers -- preset tables: each number is a voiced setting, read with its preset */
export const SPECTRE_PRESETS_DRUMS: readonly SpectrePreset[] = [
  {
    number: 1,
    label: 'Bleep Test',
    group: 'Drums',
    // Delays in leveled steps of a sixteenth, longer up the spectrum: the hats ratchet upward.
    settings: spectrePreset({
      division: '1/2',
      grid: '1/16',
      curves: {
        gain: linked(trim(flat(1), -3)),
        delay: linked(steps(800, 20000, [0.125, 0.25, 0.375, 0.5], 0), true),
        feedback: linked(band(800, 20000, 0.35, 0)),
      },
    }),
  },
  {
    number: 2,
    label: 'Hardcore Roll',
    group: 'Drums',
    // Every other run of cells repeats a thirty-second on, with middling feedback: the snare rolls.
    settings: spectrePreset({
      division: '1/4',
      grid: '1/32',
      curves: {
        gain: linked(trim(flat(1), -4)),
        delay: linked(comb(0.2, 0.125, 0), true),
        feedback: linked(comb(0.2, 0.55, 0), true),
      },
    }),
  },
  {
    number: 3,
    label: 'Shuffle Floor',
    group: 'Drums',
    // Each band pushed a fixed random way on an eighth-triplet grid: the loop swings band by band.
    settings: spectrePreset({
      division: '1/2',
      grid: '1/8T',
      scatter: 0.45,
      curves: {
        gain: linked(trim(flat(1), -2)),
        delay: linked(ramp(0.05, 0.3)),
        feedback: linked(flat(0.25)),
      },
    }),
  },
  {
    number: 4,
    label: 'Speaker Stack',
    group: 'Drums',
    // Only the loud bands pass the gate into an eighth-note echo.
    settings: spectrePreset({
      division: '1/4',
      grid: '1/8',
      mod: 'gate',
      modA: 0.65,
      modB: 1,
      modC: 0,
      curves: {
        gain: linked(trim(flat(1), -3)),
        delay: linked(flat(0.5)),
        feedback: linked(flat(0.45)),
      },
    }),
  },
  {
    number: 5,
    label: 'Jungle Splice',
    group: 'Drums',
    // Holes in the spectrum over delays that jump between one and three sixteenths: the break re-cuts itself.
    settings: spectrePreset({
      division: '1/4',
      grid: '1/16',
      mod: 'holes',
      modA: 0.8,
      modB: 0.4,
      modC: 0.3,
      curves: {
        gain: linked(trim(flat(1), -2.5)),
        delay: linked(comb(0.5, 0.25, 0.75), true),
        feedback: linked(flat(0.3)),
      },
    }),
  },
  {
    number: 6,
    label: 'Bass Bin',
    group: 'Drums',
    // Below 150 Hz a quarter-note echo with long feedback; above, dry: a dub on the kick.
    settings: spectrePreset({
      division: '1/2',
      grid: '1/4',
      curves: {
        gain: linked(trim(flat(1), -8)),
        delay: linked(within(band(20, 150, 1, 0), flat(0.5), flat(0))),
        feedback: linked(band(20, 150, 0.6, 0)),
      },
    }),
  },
];
