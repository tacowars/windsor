/**
 * The chorus insert's card (#642): Rate (Hz), Depth (ms), Spread and Mix,
 * under a preset picker (Juno I, II, I + II) and an on switch (#695).
 */
import {
  CHORUS_PRESETS,
  DEFAULT_CHORUS,
  applyChorusPreset,
  matchingChorusPreset,
} from '@windsor/engine';
import type { InsertCard } from './insertCards';
import { CHORUS_KNOBS } from './insertKnobTables';
import { presetInsertCard } from './presetInsertCard';

export const chorusCard: InsertCard = (ctx, slot, index) =>
  presetInsertCard(ctx, slot, index, {
    kind: 'chorus',
    label: 'Chorus',
    defaults: DEFAULT_CHORUS,
    presets: CHORUS_PRESETS,
    apply: applyChorusPreset,
    match: matchingChorusPreset,
    knobs: CHORUS_KNOBS,
  });
