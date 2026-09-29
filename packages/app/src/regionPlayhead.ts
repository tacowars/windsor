/**
 * The playhead every sequencer card shows for its region (windsor#97 for the
 * grid, windsor#101 for the chord and Euclidean cards): bright on the step
 * the engine is sounding while the song is inside the card's region, and a
 * dimmer ghost on the step the region's pattern would be on while it is not
 * — another region of the part playing, or none. Dark only while the
 * transport is paused or stopped; the card closing ends its loop.
 *
 * Both positions are the engine's (`host.regionStepAt`, #619 decision 2):
 * nothing here folds a tick into a region or a step, so the playhead keeps
 * going through every pattern repeat, the song's wrap to bar 1 and every
 * loop-brace wrap, which the transport's unwrapped tick never does on its own.
 *
 * The shared loop (`watchPlayhead`) re-marks when a number changes, so the
 * two strengths travel as one number: a step, a ghost step below -1, or -1.
 * `lightPlayhead` turns that number into a `.playing` or `.ghost` class on
 * one child of a strip — a grid or chord column, a Euclidean cell — and each
 * card's CSS draws the two strengths on whatever marks its step.
 */
import type { AppCtx } from './context';

/** Nothing lit. */
export const DARK = -1;

/** A ghost on `step`: below `DARK`, so it never reads as a bright step. */
export const ghostOf = (step: number): number => DARK - 1 - step;

/** What a playhead number lights: the step, and whether it is the ghost; null for dark. */
export function readPlayhead(playhead: number): { step: number; ghost: boolean } | null {
  if (playhead >= 0) return { step: playhead, ghost: false };
  if (playhead === DARK) return null;
  return { step: DARK - 1 - playhead, ghost: true };
}

/**
 * The playhead for region `region` of the part on `slot`: the step bright
 * while the audible tick is in the region, its ghost while it is not, `DARK`
 * while the transport is not running. With no region named it is the part's
 * own step, bright or dark.
 */
export function regionPlayheadAt(ctx: AppCtx, slot: number, region?: number): number {
  if (!ctx.transport.running) return DARK;
  const tick = ctx.transport.position();
  if (region === undefined) return ctx.host.stepAt(slot, tick);
  const at = ctx.host.regionStepAt(slot, region, tick);
  if (!at || at.step < 0) return DARK;
  return at.live ? at.step : ghostOf(at.step);
}

/**
 * What lighting the playhead reads of a strip — its children's class lists.
 * Structural on purpose: a real element satisfies it, and so does a test's
 * stand-in, so the loop and its lighting are driven without a DOM.
 */
export interface LitStrip {
  readonly children: ArrayLike<{
    readonly classList: { toggle(token: string, on: boolean): void };
  }>;
}

/** Light the playhead's child of a strip, `playing` bright or `ghost` dim, and clear the rest. */
export function lightPlayhead(strip: LitStrip, playhead: number): void {
  const lit = readPlayhead(playhead);
  const { children } = strip;
  for (let i = 0; i < children.length; i++) {
    const on = lit !== null && lit.step === i;
    children[i]?.classList.toggle('playing', on && !lit.ghost);
    children[i]?.classList.toggle('ghost', on && lit.ghost);
  }
}
