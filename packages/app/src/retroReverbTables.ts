/** Retro reverb controls use the engine's bounds and initial values. */
import { DEFAULT_RETRO_REVERB, RETRO_REVERB_BOUNDS } from '@windsor/engine';
import type { RetroReverbSpec } from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';
import { fmt2, fmtHz, fmtMs } from './consoleFormat';

const fields = [
  ['decay', 'Decay'],
  ['size', 'Size'],
  ['tone', 'Tone'],
  ['diffusion', 'Diffusion'],
  ['preDelay', 'Pre-delay'],
  ['character', 'Character'],
  ['duration', 'Time'],
  ['mix', 'Mix'],
] as const;
export const RETRO_REVERB_KNOBS: readonly InsertKnobEntry<RetroReverbSpec>[] = fields.map(
  ([f, label]) => ({
    f,
    label,
    o: {
      min: RETRO_REVERB_BOUNDS[f][0],
      max: RETRO_REVERB_BOUNDS[f][1],
      def: DEFAULT_RETRO_REVERB[f],
      fmt:
        f === 'tone' ? fmtHz : f === 'decay' || f === 'preDelay' || f === 'duration' ? fmtMs : fmt2,
      ...(f === 'tone' || f === 'decay' ? { curve: 'log' as const } : {}),
    },
  }),
);
