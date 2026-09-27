/**
 * The Song view's tunables (#709, epic #703 decision 1): the px-per-bar
 * scale and the lane-name column, the drag thresholds, and the per-kind
 * lookups the lanes read — a lane's tone (teal for the pitched kinds, amber
 * for Euclidean), the one summary line a region block shows, the pattern's
 * cycle length for the faint ticks inside a block, and which kinds the
 * detail pane gives an Octave knob because their card carries none. Data
 * beside the logic (root CLAUDE.md "Code structure"); the px maths is pinned
 * by `songViewTables.test.ts`. A zoom control is a follow-up (decision 8):
 * `pxPerBar` is a table value, not a state.
 */
import type {
  SequencerKind,
  SequencerSpec,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  BEATS_PER_BAR,
  PPQ,
  TICKS_PER_BAR,
} from '../../../packages/client/src/audio/index-for-editor';
import { BASS_MODE_OPTIONS } from './bassModel';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { ARP_STYLE_LABELS } from './sequencerKnobTables';

export interface SongViewScale {
  /** Px one bar of `TICKS_PER_BAR` ticks spans on the ruler and in every lane. */
  readonly pxPerBar: number;
  /** The lane-name column to the left of the ruler and the lanes. */
  readonly laneNameWidthPx: number;
  /** The grid gap between the name column and a lane. */
  readonly laneGapPx: number;
}

export const SONG_VIEW: SongViewScale = { pxPerBar: 96, laneNameWidthPx: 120, laneGapPx: 8 };

/** A pointer moved this far is a resize or a move; under it, a click. */
export const SONG_DRAG_THRESHOLD_PX = 4;
/** The band at each end of a region block that drags its edge instead of moving it. */
export const REGION_EDGE_PX = 8;
/** The gap a block leaves before the next one's left edge, so adjoining regions read as two. */
export const BLOCK_GAP_PX = 2;

/** Px from the song start for a tick — the playhead line's, a block's left edge. */
export const tickToPx = (tick: number, pxPerBar: number = SONG_VIEW.pxPerBar): number =>
  (tick / TICKS_PER_BAR) * pxPerBar;

/** The tick under a px offset from the song start (unsnapped; `regionModel.ts` snaps). */
export const pxToTick = (px: number, pxPerBar: number = SONG_VIEW.pxPerBar): number =>
  (px / pxPerBar) * TICKS_PER_BAR;

/** The ruler's bar labels: `1..bars`. */
export const rulerLabels = (bars: number): string[] =>
  Array.from({ length: Math.max(0, Math.trunc(bars)) }, (_, i) => String(i + 1));

/** The px offsets of the beat ticks inside one bar (the first beat is the bar line itself). */
export const beatTickPx = (pxPerBar: number = SONG_VIEW.pxPerBar): number[] =>
  Array.from({ length: BEATS_PER_BAR - 1 }, (_, i) => tickToPx((i + 1) * PPQ, pxPerBar));

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
