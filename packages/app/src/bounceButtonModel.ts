/**
 * Whether the Song view's pane header shows Bounce to Roll for a part, and
 * how (windsor#742, record `2026-10-11-bounce-to-roll` decision 1): on the
 * seven generating kinds, disabled with its reason on a part with no regions,
 * and absent on a Roll or a part with no sequencer.
 */
import type { MusicPart } from '@windsor/engine';
import { BOUNCE_BUTTON, BOUNCE_KINDS } from './bounceTables';

export interface BounceButtonState {
  readonly disabled: boolean;
  readonly title: string;
}

/** The button's state for `part`; null when it is not shown. */
export function bounceButtonState(
  part: Pick<MusicPart, 'sequencer' | 'regions'>,
  kinds: readonly string[] = BOUNCE_KINDS,
): BounceButtonState | null {
  if (!kinds.includes(part.sequencer.kind)) return null;
  const disabled = part.regions.length === 0;
  return { disabled, title: disabled ? BOUNCE_BUTTON.noRegions : BOUNCE_BUTTON.title };
}
