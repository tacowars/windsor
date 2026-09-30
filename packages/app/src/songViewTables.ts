/**
 * The Song view's tunables (#709, epic #703 decision 1): the px-per-bar
 * scale and the lane-name column, the drag thresholds, and the per-kind
 * lookups the lanes read — a lane's tone (teal for the pitched kinds, amber
 * for Euclidean), the one summary line a region block shows, the pattern's
 * cycle length for the faint ticks inside a block, and which kinds the
 * detail pane gives an Octave knob because their card carries none. Data
 * beside the logic (root CLAUDE.md "Code structure"); the px maths is pinned
 * by `songViewTables.test.ts`. The zoom (windsor#8) makes `pxPerBar` view
 * state in `songTab.ts`: `SONG_VIEW.pxPerBar` is where it starts, and
 * `minPxPerBar` / `maxPxPerBar` / `dragPxPerDoubling` bound the ruler drag
 * that changes it (`songZoomModel.ts`). Since windsor#21 the zoom's real
 * floor is the scale that fits the whole song in the window;
 * `minPxPerBar` is only the absolute floor under it.
 */
import type { SequencerKind, SequencerSpec } from '@windsor/engine';
import { BEATS_PER_BAR, PPQ, TICKS_PER_BAR } from '@windsor/engine';
import { BASS_MODE_OPTIONS } from './bassModel';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { ARP_STYLE_LABELS } from './sequencerKnobTables';

export interface SongViewScale {
  /** Px one bar of `TICKS_PER_BAR` ticks spans on the ruler and in every lane, before any zoom. */
  readonly pxPerBar: number;
  /** The zoom's absolute floor, under the fit (windsor#21): below it a long song in a narrow window scrolls. */
  readonly minPxPerBar: number;
  /** The zoom's ceiling: a sixteenth is still a comfortable drag target at this scale. */
  readonly maxPxPerBar: number;
  /** Px of vertical ruler drag that doubles (up) or halves (down) the scale. */
  readonly dragPxPerDoubling: number;
  /** The narrowest a ruler label's stretch may be; below it the labels thin to every 2nd, 4th… bar. */
  readonly minLabelPx: number;
  /** The lane-name column to the left of the ruler and the lanes. */
  readonly laneNameWidthPx: number;
  /**
   * The mixer column between the names and the timeline (windsor#157): a
   * part's Level, its value, M and S on one row. Frozen with the names.
   */
  readonly mixerWidthPx: number;
  /**
   * The expanded mixer column (windsor#158) besides its knobs: the arrow's
   * gutter, the Output select, M and S, the gaps between them and the cell's
   * padding, as `console.css`'s `.mix-cell.expanded` sizes them.
   */
  readonly mixerExpandedBasePx: number;
  /** Each knob column of the expanded mixer, with the gap after it: a compact dial and a five-character value. */
  readonly mixerKnobColumnPx: number;
  /** The grid gap between two columns: the names, the mixer and the timeline. */
  readonly laneGapPx: number;
}

export const SONG_VIEW: SongViewScale = {
  pxPerBar: 96,
  minPxPerBar: 8,
  maxPxPerBar: 768,
  dragPxPerDoubling: 60,
  minLabelPx: 28,
  laneNameWidthPx: 120,
  mixerWidthPx: 132,
  mixerExpandedBasePx: 165,
  mixerKnobColumnPx: 70,
  laneGapPx: 8,
};

/**
 * The mixer column's width (windsor#158 decision 5): the collapsed strip's,
 * or expanded, the base plus one column a knob. The timeline starts past it,
 * so it moves right as the column widens.
 */
export const mixerColumnPx = (
  expanded: boolean,
  knobs: number,
  scale: Pick<
    SongViewScale,
    'mixerWidthPx' | 'mixerExpandedBasePx' | 'mixerKnobColumnPx'
  > = SONG_VIEW,
): number =>
  expanded ? scale.mixerExpandedBasePx + knobs * scale.mixerKnobColumnPx : scale.mixerWidthPx;

/**
 * The CSS `left` of a line `bars` bars into the timeline, in the lanes
 * grid's own variables (`--names`, `--mixer`, `--gap`, `--bar`): past the
 * name column, the mixer column and the gap after each (windsor#157). The
 * playhead and the loop lines both read it, so a zoom moves them with the
 * regions and a column change moves both.
 */
export const timelineLeftCss = (bars: number): string =>
  `calc(var(--names) + var(--mixer) + 2 * var(--gap) + var(--bar) * ${bars})`;

/**
 * How near the fit a zoom may be and still count as fitted (windsor#21): a
 * view at the fit follows it when the window or the song length changes it.
 */
export const FIT_TOLERANCE_PX = 0.5;

/** A pointer moved this far is a resize or a move; under it, a click. */
export const SONG_DRAG_THRESHOLD_PX = 4;
/** The primary (left) button's bit in `PointerEvent.buttons`. */
export const PRIMARY_BUTTON_BIT = 1;

/**
 * Whether a move still has the primary button down. A drag that sees a move
 * without it missed its release (a window blur, a release the browser never
 * reported) and must end there, or it would follow a plain hover.
 */
export const primaryHeld = (buttons: number): boolean => (buttons & PRIMARY_BUTTON_BIT) !== 0;
/** The band at each end of a region block that drags its edge instead of moving it. */
export const REGION_EDGE_PX = 8;
/** The gap a block leaves before the next one's left edge, so adjoining regions read as two. */
export const BLOCK_GAP_PX = 2;
/** The narrowest a block renders, whatever the zoom: a one-beat event at `minPxPerBar` stays visible and grabbable. */
export const MIN_BLOCK_PX = 6;
/**
 * The horizontal padding plus side borders a `.reg` or `.hblk` draws at full
 * size (`console.css`: 6 px padding and a 1 px border each side, pinned by
 * `songViewTables.test.ts`). A block narrower than this is drawn `.narrow`,
 * without padding, so its drawn width is exactly `blockBox`'s and the hit
 * test and the eye agree.
 */
export const NARROW_BLOCK_PX = 14;
/** The largest share of a block's width each edge band may take, so the body always keeps a movable middle. */
export const EDGE_BAND_FRACTION = 0.25;

/**
 * The loop brace (windsor#30): the bars the loop button creates when the
 * song has no loop yet (clamped to the song), and the grab zone of each
 * inward-pointing handle — its width inside the brace, capped at a share of
 * a narrow brace so the body keeps a movable middle, and a little reach
 * outside it so a handle stays grabbable at the widest zoom-out.
 */
export interface LoopBraceTable {
  readonly newLoopBars: number;
  readonly handlePx: number;
  readonly handleOutsidePx: number;
  readonly handleFraction: number;
}

export const LOOP_BRACE: LoopBraceTable = {
  newLoopBars: 4,
  handlePx: 8,
  handleOutsidePx: 4,
  handleFraction: 0.25,
};

/** Px from the song start for a tick — the playhead line's, a block's left edge. */
export const tickToPx = (tick: number, pxPerBar: number): number =>
  (tick / TICKS_PER_BAR) * pxPerBar;

/** The tick under a px offset from the song start (unsnapped; `regionModel.ts` snaps). */
export const pxToTick = (px: number, pxPerBar: number): number => (px / pxPerBar) * TICKS_PER_BAR;

/** The ruler's bar labels: `1..bars`. */
export const rulerLabels = (bars: number): string[] =>
  Array.from({ length: Math.max(0, Math.trunc(bars)) }, (_, i) => String(i + 1));

/** Label every n-th bar, n a power of two, so no label's stretch is narrower than `minLabelPx`. */
export function rulerLabelEvery(
  pxPerBar: number,
  minLabelPx: number = SONG_VIEW.minLabelPx,
): number {
  let every = 1;
  if (!(pxPerBar > 0)) return every;
  while (every * pxPerBar < minLabelPx) every *= 2;
  return every;
}

/** The px offsets of the beat ticks inside one bar (the first beat is the bar line itself). */
export const beatTickPx = (pxPerBar: number): number[] =>
  Array.from({ length: BEATS_PER_BAR - 1 }, (_, i) => tickToPx((i + 1) * PPQ, pxPerBar));

/** Where a block draws on its lane, in px from the song start. */
export interface BlockBox {
  readonly leftPx: number;
  readonly widthPx: number;
}

/**
 * The drawn box of a block spanning `durationTicks` from `startTick`: its
 * span less the gap to the next block, never narrower than `MIN_BLOCK_PX`
 * (windsor#8: at the widest zoom-out a one-beat block would otherwise be
 * 0 px wide and unselectable).
 */
export function blockBox(startTick: number, durationTicks: number, pxPerBar: number): BlockBox {
  return {
    leftPx: tickToPx(startTick, pxPerBar),
    widthPx: Math.max(MIN_BLOCK_PX, tickToPx(durationTicks, pxPerBar) - BLOCK_GAP_PX),
  };
}

/** A block too narrow for its padding: drawn `.narrow`, so the CSS cannot widen it past its hit box. */
export const isNarrowBlock = (widthPx: number): boolean => widthPx < NARROW_BLOCK_PX;

/** The band at each end of a drawn block that drags that edge: `REGION_EDGE_PX`, capped at a share of the width. */
export const edgeBandPx = (widthPx: number): number =>
  Math.min(REGION_EDGE_PX, widthPx * EDGE_BAND_FRACTION);

/**
 * The tick under a press `px` from the song start on the drawn `box` of a
 * block spanning `durationTicks` from `startTick` (windsor#21): the plain
 * conversion while the box is no wider than its span, and the press's share
 * of the box mapped onto the span once `MIN_BLOCK_PX` has widened it — so
 * every px of a widened block lands inside its own span, never past it.
 */
export function boxTick(
  box: BlockBox,
  px: number,
  span: { readonly startTick: number; readonly durationTicks: number },
  pxPerBar: number,
): number {
  const spanPx = tickToPx(span.durationTicks, pxPerBar);
  const share = Math.min(1, Math.max(0, (px - box.leftPx) / Math.max(box.widthPx, spanPx)));
  return span.startTick + share * span.durationTicks;
}

export type BlockHit = 'start' | 'end' | 'body';

/** What a press `px` from the song start hits on `box`: an edge band, the body between them, or nothing. */
export function blockHitAt(box: BlockBox, px: number): BlockHit | null {
  const offset = px - box.leftPx;
  if (offset < 0 || offset > box.widthPx) return null;
  const band = edgeBandPx(box.widthPx);
  if (offset < band) return 'start';
  if (offset > box.widthPx - band) return 'end';
  return 'body';
}

/** The topmost drawn box under `px` (the last, as later blocks draw over earlier ones) and what it hits there; null in a gap. */
export function hitBlocks(
  boxes: readonly BlockBox[],
  px: number,
): { index: number; hit: BlockHit } | null {
  for (let index = boxes.length - 1; index >= 0; index--) {
    const box = boxes[index];
    const hit = box ? blockHitAt(box, px) : null;
    if (hit) return { index, hit };
  }
  return null;
}

export type LaneTone = 'pitch' | 'perc' | 'none';

/** Which accent a kind's regions draw in: teal for pitched kinds, amber for Euclidean (decision 1). */
export const LANE_TONE: Readonly<Record<SequencerKind, LaneTone>> = {
  none: 'none',
  euclidean: 'perc',
  grid: 'pitch',
  chord: 'pitch',
  arp: 'pitch',
  bass: 'pitch',
};

/**
 * Kinds whose card has no register knob of its own, so the detail pane adds
 * the Octave knob above the card: the arp and bass cards carry Reg (#706,
 * #707) and a second control on the same field is what #713's review found
 * going stale.
 */
export const PANE_OCTAVE_KINDS: readonly SequencerKind[] = ['grid', 'chord'];

/** One function per kind over that kind's own spec — the lanes look a part up here, never branch. */
export type KindTable<T> = {
  readonly [K in SequencerKind]: (spec: Extract<SequencerSpec, { kind: K }>) => T;
};

/** Apply a kind table to a spec; the cast is the discriminated union's, which TypeScript cannot correlate through an index. */
export function forKind<T>(table: KindTable<T>, spec: SequencerSpec): T {
  return (table[spec.kind] as (s: SequencerSpec) => T)(spec);
}

const divisorLabel = (divisor: number): string =>
  DIVISOR_OPTIONS.find((o) => Number(o.value) === divisor)?.label ?? `${divisor}t`;

/** The summary a region block shows in small caps, after the kind's name. */
export const REGION_SUMMARY: KindTable<string> = {
  none: () => 'no sequencer',
  euclidean: (spec) => `euclid ${spec.pulses.start}/${spec.steps} · ${divisorLabel(spec.divisor)}`,
  grid: (spec) => `grid · ${spec.length} steps · ${divisorLabel(spec.divisor)}`,
  chord: (spec) => `chord · ${spec.steps.length} steps · ${divisorLabel(spec.divisor)}`,
  arp: (spec) => `arp · ${ARP_STYLE_LABELS[spec.style]} ${divisorLabel(spec.divisor)}`,
  bass: (spec) =>
    `bass · ${BASS_MODE_OPTIONS.find((o) => o.value === spec.pitchMode)?.label ?? spec.pitchMode}`,
};

/**
 * The pattern's cycle in ticks, for the faint ticks inside a block (decision
 * 1): the written length for a grid, the steps' durations and repeats for a
 * Chord Player, `steps` for a Euclidean line; null for the kinds that have
 * none (arp, bass) or a cycle with nothing in it.
 */
export const CYCLE_TICKS: KindTable<number | null> = {
  none: () => null,
  euclidean: (spec) => (spec.steps > 0 ? spec.steps * spec.divisor : null),
  grid: (spec) => (spec.length > 0 ? spec.length * spec.divisor : null),
  chord: (spec) => {
    const steps = spec.steps.reduce((sum, step) => sum + step.duration * step.repeat, 0);
    return steps > 0 ? steps * spec.divisor : null;
  },
  arp: () => null,
  bass: () => null,
};
