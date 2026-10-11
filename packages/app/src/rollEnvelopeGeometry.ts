/**
 * The shown envelope's geometry over the note pane (windsor#707 decision 6;
 * epic windsor#699 decisions 3 and 4), without the DOM: the Song lanes'
 * own curve (`curveShape`) on the envelope's linear −1..1 row
 * (`ROLL_ENVELOPE_ROW`), 0 on the pane's middle line, drawn once across the
 * loop and repeated over the region, every pass after the first ghosted
 * over the hatched repeats.
 *
 * - A point at or past the loop is kept and silent: it draws no dot and
 *   bends no line, and the curve holds the last value heard, as the
 *   evaluator reads it (`envelopeValueAt`).
 * - An envelope with no point heard draws its flat 0 line.
 */
import type { RollEnvelopePoint } from '@windsor/engine';
import { ROLL_ENVELOPE_ROW, toDisplay } from '@windsor/engine';
import { type CurveShape, curveShape, laneY } from './songAutomationCurve';

/** Where the envelope draws: the pane's height and the roll's px per tick, loop and region. */
export interface EnvelopeFrame {
  readonly heightPx: number;
  readonly pxPerTick: number;
  readonly loopTicks: number;
  readonly regionTicks: number;
}

/** One repeat of the loop across the region: where it starts and how wide it is in px. */
export interface EnvelopePass {
  readonly x: number;
  readonly width: number;
  readonly ghost: boolean;
}

/** The curve across one loop, the passes it is drawn at, and the 0 line's height. */
export interface EnvelopeGeometry {
  readonly curve: CurveShape;
  readonly passes: readonly EnvelopePass[];
  readonly zeroY: number;
}

const FLAT: readonly RollEnvelopePoint[] = [{ tick: 0, value: 0, bend: 0 }];

/** The loop's repeats across the region, the first one live and the rest ghosts. */
export function envelopePasses(frame: EnvelopeFrame): EnvelopePass[] {
  const { pxPerTick, regionTicks } = frame;
  const loop = Math.min(frame.loopTicks, regionTicks);
  if (!(loop > 0)) return [];
  const passes: EnvelopePass[] = [];
  for (let start = 0; start < regionTicks; start += loop) {
    const width = Math.min(loop, regionTicks - start) * pxPerTick;
    passes.push({ x: start * pxPerTick, width, ghost: start > 0 });
  }
  return passes;
}

/** The px from the pane's top where a value of −1..1 draws. */
export const envelopeY = (value: number, heightPx: number): number =>
  laneY(toDisplay(ROLL_ENVELOPE_ROW, value), heightPx);

/** The envelope's points drawn over `frame`. */
export function envelopeGeometry(
  points: readonly RollEnvelopePoint[],
  frame: EnvelopeFrame,
): EnvelopeGeometry {
  const loop = Math.min(frame.loopTicks, frame.regionTicks);
  const heard = points.filter((point) => point.tick < loop);
  const shape = curveShape(ROLL_ENVELOPE_ROW, heard.length > 0 ? heard : FLAT, {
    widthPx: loop * frame.pxPerTick,
    heightPx: frame.heightPx,
    pxPerBar: frame.pxPerTick,
    ticksPerBar: 1,
  });
  const curve = heard.length > 0 ? shape : { ...shape, dots: [] };
  return { curve, passes: envelopePasses(frame), zeroY: envelopeY(0, frame.heightPx) };
}
