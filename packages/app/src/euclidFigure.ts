/**
 * The figure a Euclid card shows and captures for one region (windsor#75,
 * the capture follow-up of epic windsor#70): while the transport is inside
 * that region, the player's live figure for that region — asked for by its
 * index (`capturePattern(slot, region)`, windsor#74), so a capture in the
 * second region never freezes the first region's or the part's figure —
 * and elsewhere the region's own preview. Inside-or-not is the engine's
 * `regionStepAt` (windsor#101), which wraps the audible tick the way the
 * gate does, so the live figure comes back after the song's wrap to bar 1
 * and after every loop-brace wrap. Pure over the things it reads, so a test
 * drives it with the engine's player rig.
 */
import type { ArrangementDocument, RegionStep } from '@windsor/engine';
import { previewFigure, type Figure } from './euclidModel';
import { patternOf } from './partEdits';

/** What the figure reads: the document, the player's capture and position, and the audible tick. */
export interface FigureSource {
  readonly doc: ArrangementDocument;
  capturePattern(slot: number, region?: number): readonly boolean[] | null;
  regionStepAt(slot: number, region: number, tick: number): RegionStep | null;
  position(): number;
}

/** True while the transport is inside region `region` of the part on `slot` (always, with no region named). */
function playing(source: FigureSource, slot: number, region: number | undefined): boolean {
  if (region === undefined) return true;
  return source.regionStepAt(slot, region, source.position())?.live === true;
}

/**
 * The figure of region `region` of the Euclidean part on `slot`: the
 * player's live one for that region while it plays, else the pattern's
 * preview; empty when the part is gone or not Euclidean.
 */
export function regionFigure(source: FigureSource, slot: number, region?: number): Figure {
  const live = playing(source, slot, region) ? source.capturePattern(slot, region) : null;
  if (Array.isArray(live) && typeof live[0] === 'boolean') return live;
  const spec = patternOf(source.doc, slot, region);
  return spec?.kind === 'euclidean' ? previewFigure(spec) : [];
}
