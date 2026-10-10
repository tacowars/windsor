/** Retro reverb controls use the engine's bounds and initial values. */
import { DEFAULT_RETRO_REVERB, RETRO_REVERB_BOUNDS } from '@windsor/engine';
import type { RetroReverbSpec } from '@windsor/engine';
import type { InsertKnobEntry } from './insertKnobTables';
import { fmt2, fmtHz, fmtMs } from './consoleFormat';

/**
 * A Retro knob and the card page it sits on: the first page, or the second, Space, when `page`
 * says so (`retroReverbCard.ts` shows Space in reverb mode only).
 */
export interface RetroReverbKnobEntry extends InsertKnobEntry<RetroReverbSpec> {
  readonly page?: 'space';
}

type RetroField = keyof typeof RETRO_REVERB_BOUNDS;

/** Low decay reads as a multiple of Decay. */
const fmtTimes = (v: number): string => `×${v.toFixed(2)}`;

const fields: readonly { f: RetroField; label: string; page?: 'space' }[] = [
  { f: 'decay', label: 'Decay' },
  { f: 'size', label: 'Size' },
  { f: 'tone', label: 'Tone' },
  { f: 'diffusion', label: 'Diffusion' },
  { f: 'preDelay', label: 'Pre-delay' },
  { f: 'character', label: 'Character' },
  { f: 'duration', label: 'Time' },
  { f: 'mix', label: 'Mix' },
  { f: 'early', label: 'Early', page: 'space' },
  { f: 'driftRate', label: 'Drift rate', page: 'space' },
  { f: 'driftDepth', label: 'Drift depth', page: 'space' },
  { f: 'density', label: 'Density', page: 'space' },
  { f: 'lowDecay', label: 'Low decay', page: 'space' },
  { f: 'lowCross', label: 'Low cross', page: 'space' },
];
/**
 * On a log curve: Low decay's range, 0.25 to 4, is symmetric in its log, so ×1 (neutral) sits at
 * mid-travel.
 */
const LOG_FIELDS: readonly RetroField[] = [
  'tone',
  'decay',
  'size',
  'driftRate',
  'lowDecay',
  'lowCross',
];
function formatOf(f: RetroField): (v: number) => string {
  if (f === 'tone' || f === 'lowCross') return fmtHz;
  if (f === 'decay' || f === 'preDelay' || f === 'duration') return fmtMs;
  return f === 'lowDecay' ? fmtTimes : fmt2;
}
export const RETRO_REVERB_KNOBS: readonly RetroReverbKnobEntry[] = fields.map(
  ({ f, label, page }) => ({
    f,
    label,
    ...(page ? { page } : {}),
    o: {
      min: RETRO_REVERB_BOUNDS[f][0],
      max: RETRO_REVERB_BOUNDS[f][1],
      def: DEFAULT_RETRO_REVERB[f],
      fmt: formatOf(f),
      ...(LOG_FIELDS.includes(f) ? { curve: 'log' as const } : {}),
    },
  }),
);
