/**
 * The playhead the grid, chord and Euclidean cards show for their region
 * (windsor#97 for the grid, windsor#101 for the chord and Euclidean cards).
 * The arp and bass cards show none by design: their generators are
 * generative and have no step position. The playhead is bright on the step
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
import type { RegionStep } from '@windsor/engine';
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

/** The playhead a region step lights: bright when live, its ghost when not, `DARK` halted or with none. */
function playheadOf(running: boolean, at: RegionStep | null): number {
  if (!running || !at || at.step < 0) return DARK;
  return at.live ? at.step : ghostOf(at.step);
}

/**
 * The playhead for region `region` of the part on `slot`: the step bright
 * while the audible tick is in the region, its ghost while it is not, `DARK`
 * while the transport is not running. With no region named it is the part's
 * own step, bright or dark.
 */
export function regionPlayheadAt(ctx: AppCtx, slot: number, region?: number): number {
  if (!ctx.transport.running) return DARK;
  return regionReadAt(ctx, slot, region).playhead;
}

/** One reading of a region: the engine's step at the audible tick, and the playhead it lights. */
export interface RegionRead {
  /** The engine's step, live or the ghost, read running or not; null with no region named. */
  readonly at: RegionStep | null;
  /** What `regionPlayheadAt` returns for the same tick. */
  readonly playhead: number;
}

/**
 * The region's step and its playhead from one transport read and one
 * `regionStepAt` call, for a card that shows more of the step than the
 * playhead (the Figure's stage and rotation, windsor#510): both describe the
 * same step even when the tick moves between frames' reads.
 */
export function regionReadAt(ctx: AppCtx, slot: number, region?: number): RegionRead {
  const { running } = ctx.transport;
  const tick = ctx.transport.position();
  if (region === undefined)
    return { at: null, playhead: running ? ctx.host.stepAt(slot, tick) : DARK };
  const at = ctx.host.regionStepAt(slot, region, tick);
  return { at, playhead: playheadOf(running, at) };
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
