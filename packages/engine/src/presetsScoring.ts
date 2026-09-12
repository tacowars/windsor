import { STRINGS_ROWS } from './presetsStringsTables';
import { PADS_ROWS } from './presetsPadsTables';
import { PLUCKS_ROWS } from './presetsPlucksTables';
import { BASSES_ROWS } from './presetsBassesTables';
import { SOUNDTRACKFX_ROWS } from './presetsSoundtrackFxTables';
import { scoringEntries } from './presetsScoringVoice';
import type { Patch } from './patch';

export const SCORING_CATALOG = [
  ...scoringEntries('Strings', STRINGS_ROWS),
  ...scoringEntries('Pads', PADS_ROWS),
  ...scoringEntries('Plucks', PLUCKS_ROWS),
  ...scoringEntries('Basses', BASSES_ROWS),
  ...scoringEntries('Soundtrack FX', SOUNDTRACKFX_ROWS),
];
export const SCORING_PRESETS: Record<string, Patch> = Object.fromEntries(
  SCORING_CATALOG.map(({ id, patch }) => [id, patch]),
);
