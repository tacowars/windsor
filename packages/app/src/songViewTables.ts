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
 * that changes it (`songZoomModel.ts`).
 */
import type { SequencerKind, SequencerSpec } from '@windsor/engine';
import { BEATS_PER_BAR, PPQ, TICKS_PER_BAR } from '@windsor/engine';
import { BASS_MODE_OPTIONS } from './bassModel';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { ARP_STYLE_LABELS } from './sequencerKnobTables';

export interface SongViewScale {
  /** Px one bar of `TICKS_PER_BAR` ticks spans on the ruler and in every lane, before any zoom. */
  readonly pxPerBar: number;
  /** The zoom's floor: a `BARS_MAX` song still fits a wide screen at this scale. */
  readonly minPxPerBar: number;
  /** The zoom's ceiling: a sixteenth is still a comfortable drag target at this scale. */
  readonly maxPxPerBar: number;
  /** Px of vertical ruler drag that doubles (up) or halves (down) the scale. */
  readonly dragPxPerDoubling: number;
  /** The narrowest a ruler label's stretch may be; below it the labels thin to every 2nd, 4th… bar. */
  readonly minLabelPx: number;
  /** The lane-name column to the left of the ruler and the lanes. */
  readonly laneNameWidthPx: number;
  /** The grid gap between the name column and a lane. */
  readonly laneGapPx: number;
}

export const SONG_VIEW: SongViewScale = {
  pxPerBar: 96,
  minPxPerBar: 8,
  maxPxPerBar: 768,
  dragPxPerDoubling: 60,
  minLabelPx: 28,
  laneNameWidthPx: 120,
  laneGapPx: 8,
};

/** A pointer moved this far is a resize or a move; under it, a click. */
export const SONG_DRAG_THRESHOLD_PX = 4;
/** The band at each end of a region block that drags its edge instead of moving it. */
export const REGION_EDGE_PX = 8;
/** The gap a block leaves before the next one's left edge, so adjoining regions read as two. */
export const BLOCK_GAP_PX = 2;
/** The narrowest a block renders, whatever the zoom: a one-beat event at `minPxPerBar` stays visible and grabbable. */
export const MIN_BLOCK_PX = 6;
/** The largest share of a block's width each edge band may take, so the body always keeps a movable middle. */
export const EDGE_BAND_FRACTION = 0.25;

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

/** The band at each end of a drawn block that drags that edge: `REGION_EDGE_PX`, capped at a share of the width. */
export const edgeBandPx = (widthPx: number): number =>
  Math.min(REGION_EDGE_PX, widthPx * EDGE_BAND_FRACTION);

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
