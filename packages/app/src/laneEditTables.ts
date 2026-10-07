/**
 * The Song view's region-editing affordances, shared by the harmony track
 * (windsor#550) and the part lanes (windsor#551): the grab zones a pointer
 * hits and the cursor each one shows. The approved mockup is the source
 * (`docs/research/2026-10-03-song-region-editing/mockup.html`, layout
 * Proposed, `hitPart` / `hitHarm` / `cursorFor`; record
 * `2026-10-03-song-region-editing` decision 4). Data beside the logic in
 * `laneEditModel.ts`, which takes these as defaulted parameters.
 */

export interface LaneEditTable {
  /** Px either side of a seam (where two blocks meet) that grabs it; seams are tested before any block. */
  readonly seamHitPx: number;
  /** The largest share of either neighbouring block's span a seam's zone may take, so a short block keeps a body (the mockup's `seamOf`). */
  readonly seamFraction: number;
  /** The most px at each end of a block that grabs its edge. */
  readonly edgeMaxPx: number;
  /** The largest share of a block's drawn width each edge zone may take, so the body keeps a middle. */
  readonly edgeFraction: number;
}

export const LANE_EDIT: LaneEditTable = {
  seamHitPx: 6,
  seamFraction: 1 / 3,
  edgeMaxPx: 10,
  edgeFraction: 1 / 3,
};

/** The cursor each place on a lane shows (the mockup's `cursorFor`). */
export interface LaneCursorTable {
  /** Over a seam: the boundary between two blocks moves. */
  readonly seam: string;
  /** Over a block's start or end zone. */
  readonly edge: string;
  /** Over a harmony chord's body: it selects on release. */
  readonly pick: string;
  /** Over a part region's body, and while moving it. */
  readonly grab: string;
  readonly grabbing: string;
  /** While copying a part region's body with Cmd/Ctrl held. */
  readonly copy: string;
  /** Over an empty stretch of a part lane: a press draws a region. */
  readonly draw: string;
  /** While a part region's body is dragged where it cannot drop: another kind's lane, a lane of no part, off the lanes. */
  readonly refuse: string;
}

export const LANE_CURSORS: LaneCursorTable = {
  seam: 'col-resize',
  edge: 'ew-resize',
  pick: 'pointer',
  grab: 'grab',
  grabbing: 'grabbing',
  copy: 'copy',
  draw: 'crosshair',
  refuse: 'not-allowed',
};
