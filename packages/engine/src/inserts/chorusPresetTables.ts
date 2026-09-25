/**
 * The chorus's presets (#695 decision 4): the Juno-60's three chorus modes,
 * from pendragon-andyh's measurements of recordings. Mix and the on switch
 * stay the user's. The Juno sweeps one delay per side from 1.66 to 5.35 ms
 * (I and II) or 3.3 to 3.7 ms (I + II), so Depth is half that span; the
 * insert's own line centres and its second voice stay as they are, which is
 * why these are the Juno's rates and swings on this chorus, not a model of
 * the Juno's circuit. The right line's modulation is inverted (Spread 1);
 * I + II is mono (Spread 0). `docs/research/2026-09-25-695-ensemble.md`.
 */
import type { ChorusSpec } from './chorusInsert';
import type { InsertPreset } from './insertPresets';

const JUNO = {
  urls: ['https://github.com/pendragon-andyh/Juno60/blob/master/Chorus/README.md'],
  measured: true,
} as const;
/** Half of 5.35 − 1.66 ms: the swing either side of the centre in modes I and II. */
const JUNO_SLOW_SWING_MS = 1.845;
/** Half of 3.7 − 3.3 ms, mode I + II. Both written out, so a saved song matches them exactly. */
const JUNO_FAST_SWING_MS = 0.2;

export const CHORUS_PRESETS: readonly InsertPreset<ChorusSpec>[] = [
  {
    id: 'juno-1',
    label: 'Juno I',
    settings: { rate: 0.513, depth: JUNO_SLOW_SWING_MS, spread: 1 },
    source: JUNO,
  },
  {
    id: 'juno-2',
    label: 'Juno II',
    settings: { rate: 0.863, depth: JUNO_SLOW_SWING_MS, spread: 1 },
    source: JUNO,
  },
  {
    id: 'juno-1-2',
    label: 'Juno I + II',
    settings: { rate: 9.75, depth: JUNO_FAST_SWING_MS, spread: 0 },
    source: JUNO,
  },
];
