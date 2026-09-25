/**
 * The ensemble insert's card (#695): slow and fast LFO rate and depth, the
 * line centre, tone, width and mix, under a preset picker of sourced string
 * machines and an on switch.
 */
import {
  DEFAULT_ENSEMBLE,
  ENSEMBLE_PRESETS,
  applyEnsemblePreset,
  matchingEnsemblePreset,
} from '../../../packages/client/src/audio/index-for-editor';
import type { InsertCard } from './insertCards';
import { ENSEMBLE_KNOBS } from './insertKnobTables';
import { presetInsertCard } from './presetInsertCard';

export const ensembleCard: InsertCard = (ctx, slot, index) =>
  presetInsertCard(ctx, slot, index, {
    kind: 'ensemble',
    label: 'Ensemble',
    defaults: DEFAULT_ENSEMBLE,
    presets: ENSEMBLE_PRESETS,
    apply: applyEnsemblePreset,
    match: matchingEnsemblePreset,
    knobs: ENSEMBLE_KNOBS,
  });
