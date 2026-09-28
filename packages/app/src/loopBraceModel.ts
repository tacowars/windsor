/**
 * The loop brace's rules (windsor#30, Ableton Live's loop brace), pure: what
 * a press on the brace strip under the Song view's ruler hits, what a drag
 * from it makes of the loop, the range the loop button creates, and the
 * partial every edit writes. No DOM — `loopBraceModel.test.ts` pins them,
 * and `loopBrace.ts` only wires them.
 *
 * A drag in empty strip space draws a new range over every bar it touches;
 * a handle moves its end and the body the whole range, each by the
 * pointer's travel from the press, so a press a few px off an edge never
 * jumps it. Every edit snaps to bars, or to beats with Shift (the region
 * drags' modifier), and every result is a range the engine keeps as it is
 * (`fitLoopRange`): on the beat grid, inside the song, at least a beat long.
 */
import type { DocumentPartial, SongLoop } from '@windsor/engine';
import { LOOP_GRID_TICKS, TICKS_PER_BAR } from '@windsor/engine';
import type { BlockBox, LoopBraceTable } from './songViewTables';
import { LOOP_BRACE, pxToTick, tickToPx } from './songViewTables';

/** A loop's tick range, `[start, end)`. */
export interface LoopRange {
  readonly start: number;
  readonly end: number;
}

/** What a press on the brace hits: a handle, the body between them. */
export type BraceHit = 'start' | 'end' | 'body';

/** A drag from empty strip space draws; one from the brace edits the range it pressed. */
export type BraceGesture =
  | { readonly kind: 'draw'; readonly anchorTick: number }
  | { readonly kind: BraceHit; readonly range: LoopRange; readonly pressTick: number };

/** Where a drag lands: its snap grain and the song it stays inside. */
export interface BraceBounds {
  readonly grain: number;
  readonly songTicks: number;
}

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));
const snapRound = (tick: number, grain: number): number => Math.round(tick / grain) * grain;

/** The snap grain in ticks: a bar, or a beat with Shift (decision 3). */
export const loopGrain = (shift: boolean): number => (shift ? LOOP_GRID_TICKS : TICKS_PER_BAR);

/** The range the loop button creates when the song has none (decision 1): bars 1–4, clamped to the song. */
export const newLoopRange = (songTicks: number, table: LoopBraceTable = LOOP_BRACE): LoopRange => ({
  start: 0,
  end: Math.min(songTicks, table.newLoopBars * TICKS_PER_BAR),
});

/** Where the brace draws on its strip, in px from the song start. */
export const braceBox = (range: LoopRange, pxPerBar: number): BlockBox => ({
  leftPx: tickToPx(range.start, pxPerBar),
  widthPx: tickToPx(range.end - range.start, pxPerBar),
});

/**
 * What a press `px` from the song start hits on the brace of `range`: a
 * handle's band inside either end (capped at a share of a narrow brace, so
 * the body keeps its middle) or its reach just outside, the body between,
 * or nothing.
 */
export function braceHitAt(
  range: LoopRange | undefined,
  px: number,
  pxPerBar: number,
  table: LoopBraceTable = LOOP_BRACE,
): BraceHit | null {
  if (!range) return null;
  const { leftPx, widthPx } = braceBox(range, pxPerBar);
  const rightPx = leftPx + widthPx;
  if (px < leftPx - table.handleOutsidePx || px > rightPx + table.handleOutsidePx) return null;
  const band = Math.min(table.handlePx, widthPx * table.handleFraction);
  if (px < leftPx + band) return 'start';
  if (px > rightPx - band) return 'end';
  return 'body';
}

/** The gesture a press `px` from the song start starts over the song's `loop`. */
export function braceGestureAt(
  loop: LoopRange | undefined,
  px: number,
  pxPerBar: number,
  table: LoopBraceTable = LOOP_BRACE,
): BraceGesture {
  const pressTick = pxToTick(px, pxPerBar);
  const hit = braceHitAt(loop, px, pxPerBar, table);
  if (!hit || !loop) return { kind: 'draw', anchorTick: pressTick };
  return { kind: hit, range: { start: loop.start, end: loop.end }, pressTick };
}

/**
 * A new range between the press and the pointer, over every grain it
 * touches: the lower tick snapped down, the higher snapped up, at least one
 * grain long, inside the song.
 */
export function drawRange(anchorTick: number, tick: number, bounds: BraceBounds): LoopRange {
  const { grain, songTicks } = bounds;
  const lo = clamp(Math.min(anchorTick, tick), 0, songTicks);
  const hi = clamp(Math.max(anchorTick, tick), 0, songTicks);
  const end = Math.min(songTicks, Math.max(Math.ceil(hi / grain) * grain, lo + grain));
  const start = Math.max(0, Math.min(Math.floor(lo / grain) * grain, end - grain));
  return { start, end };
}

/**
 * A drag of the brace to `tick`: the pressed handle or the body moves by the
 * pointer's travel from `pressTick`, snapped to the grain. A handle stops a
 * beat short of the other end and at the song's ends; the body keeps its
 * length and stays inside the song.
 */
export function dragBrace(gesture: BraceGesture, tick: number, bounds: BraceBounds): LoopRange {
  if (gesture.kind === 'draw') return drawRange(gesture.anchorTick, tick, bounds);
  const { grain, songTicks } = bounds;
  const { range, pressTick } = gesture;
  const delta = tick - pressTick;
  switch (gesture.kind) {
    case 'start':
      return {
        start: clamp(snapRound(range.start + delta, grain), 0, range.end - LOOP_GRID_TICKS),
        end: range.end,
      };
    case 'end':
      return {
        start: range.start,
        end: clamp(snapRound(range.end + delta, grain), range.start + LOOP_GRID_TICKS, songTicks),
      };
    case 'body': {
      const length = range.end - range.start;
      const start = clamp(
        snapRound(range.start + delta, grain),
        0,
        Math.max(0, songTicks - length),
      );
      return { start, end: start + length };
    }
  }
}

/** The ticks the lines through the lanes mark: the loop's ends while it is on, none otherwise (decision 2). */
export const loopLineTicks = (loop: SongLoop | undefined): number[] =>
  loop?.on ? [loop.start, loop.end] : [];

/** A range and its on state as the live partial every loop edit writes: the whole loop, so an export carries it. */
export const loopChange = (range: LoopRange, on: boolean): DocumentPartial => ({
  transport: { loop: { start: range.start, end: range.end, on } },
});
