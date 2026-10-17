/**
 * A version-17 Dub delay entry in the version-18 shape (record
 * `2026-10-17-dub-delay-regeneration`). The old delay's loop was a high pass,
 * a low pass and a saturator; the new one's is a low cut, a shaped filter,
 * a governed saturation and a damping shelf. So:
 *
 * - `highpass` becomes `lowCut`, and `lowpass` a flat (0 dB) lowpass
 *   `cutoff`, each clamped into its new range;
 * - `feedback` keeps its value up to unity, its new top (the old one ran to
 *   1.2, where a saturator held it; the governor now does that);
 * - ping-pong becomes ping-pong with Cross 1, which alternated every repeat
 *   as the old mode did, and every other mode Cross 0;
 * - Drive keeps its dB; Damping, Wow and Sweep start at 0, which the old
 *   delay did not have.
 *
 * The rest (times, divisions, mode, mix, output, the switch) keeps its value,
 * and every new field the normaliser fills from its default. It is close,
 * not identical: the new saturation is a different curve. A lane on the old
 * `highpass` or `lowpass` has no field to follow and is dropped by the lane
 * normaliser, as any lane on a field its kind does not automate.
 * `songMigrations.test.ts` pins it.
 */
import { DELAY_BOUNDS } from '../inserts/delayConstants';

const clamp = (value: unknown, [min, max]: readonly [number, number]): number | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined;

export function upgradeDelayEntry(entry: Record<string, unknown>): Record<string, unknown> {
  if (entry['kind'] !== 'delay') return entry;
  const { highpass, lowpass, feedback, ...rest } = entry;
  const out: Record<string, unknown> = {
    ...rest,
    filter: 'lowpass',
    resonance: 0,
    cross: entry['mode'] === 'ping-pong' ? 1 : 0,
    damping: 0,
    wow: 0,
    sweep: 0,
  };
  const lowCut = clamp(highpass, DELAY_BOUNDS.lowCut);
  const cutoff = clamp(lowpass, DELAY_BOUNDS.cutoff);
  const gain = clamp(feedback, DELAY_BOUNDS.feedback);
  if (lowCut !== undefined) out['lowCut'] = lowCut;
  if (cutoff !== undefined) out['cutoff'] = cutoff;
  if (gain !== undefined) out['feedback'] = gain;
  return out;
}
