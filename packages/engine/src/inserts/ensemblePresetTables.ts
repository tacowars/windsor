/**
 * The ensemble's presets (#695 decision 9): string machines with a public
 * source, each labelled by what the source states. No preset exists without
 * a source, and none is generic. Width, Mix and the on switch stay the
 * user's. Sources, per-value provenance and the machines dropped for want of
 * one: `docs/research/2026-09-25-695-ensemble.md`.
 *
 * What no source states for any string machine is the delay swing in ms or
 * the line centre (the BBD clock), so those are approximations everywhere:
 * the Juno-60's measured ±1.85 ms chorus swing is the scale, and the Logan
 * String Melody's stated 79 : 21 slow-to-fast mix sets the fast depth.
 */
import { ENSEMBLE_DEFAULTS, ENSEMBLE_FAST_SHARE } from './ensembleConstants';
import type { EnsembleSpec } from './ensembleSpec';
import type { InsertPreset } from './insertPresets';

const RS202_SLOW_DEPTH_MS = 1.5;
const { slowRate, slowDepth, fastRate, fastDepth, delay, tone } = ENSEMBLE_DEFAULTS;

export const ENSEMBLE_PRESETS: readonly InsertPreset<EnsembleSpec>[] = [
  {
    // The kind's defaults are the Solina's (`ensembleConstants.ts` says which
    // values are stated). The Logan String Melody states the same rates and
    // chips, so one preset serves both: two would be indistinguishable.
    id: 'solina',
    label: 'ARP Solina / Logan String Melody',
    settings: { slowRate, slowDepth, fastRate, fastDepth, delay, tone },
    source: {
      urls: [
        'http://jhaible.com/legacy/triple_chorus/triple_chorus.html',
        'https://till-kopper.de/logan_string_melody.html',
        'https://www.modwiggler.com/forum/viewtopic.php?t=265377&start=50',
      ],
      measured: false,
    },
  },
  {
    // Rates: the 1976 service notes' scope traces, 6.25 Hz (160 ms) and
    // 0.66 Hz. Three 512-stage MN3002 lines against the Solina's 185-stage
    // TCA350s: a longer centre, and Sound On Sound's "faster, deeper" mode I.
    id: 'rs-202',
    label: 'Roland RS-202 (Ensemble I)',
    settings: {
      slowRate: 0.66,
      slowDepth: RS202_SLOW_DEPTH_MS,
      fastRate: 6.25,
      fastDepth: Math.round(RS202_SLOW_DEPTH_MS * ENSEMBLE_FAST_SHARE * 100) / 100,
      delay: 8,
      tone,
    },
    source: {
      urls: [
        'https://archive.org/details/Roland_RS-202_Service_Notes',
        'https://www.soundonsound.com/reviews/roland-rs202-multivox-mx202-retrozone',
      ],
      measured: false,
    },
  },
];
