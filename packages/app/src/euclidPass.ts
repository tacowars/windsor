/**
 * The pass the Euclid card's under-the-hits view lays its lanes out for
 * (windsor#383, decision 1). While the transport runs it is the trigger's
 * pass at the audible step. While it is paused it is the pass at the tick
 * the pause kept (`HostTransport.pause`), so the cells, the restart notches
 * and the lane index an edit writes are the ones the resume plays. Stopped,
 * or in the own-length view, it is pass 0.
 */
import type { RegionStep } from '@windsor/engine';
import type { LaneView } from './euclidLaneView';
import { passOf } from './euclidLaneView';
import type { TransportState } from './transportModel';

/** What the pass is read from: the view, the trigger's steps, the frame's step and the transport. */
export interface PassSource {
  readonly view: LaneView;
  readonly steps: number;
  /** The frame's region step: null while the transport is halted. */
  readonly at: RegionStep | null;
  readonly state: TransportState;
  /** The region's step at the tick the transport holds, read only while paused. */
  heldStep(): RegionStep | null;
}

/** The pass the under-the-hits cells show; 0 in the own-length view. */
export function shownPass(source: PassSource): number {
  if (source.view !== 'hits') return 0;
  if (source.at) return passOf(source.at, source.steps);
  return source.state === 'paused' ? passOf(source.heldStep(), source.steps) : 0;
}
