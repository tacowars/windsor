/**
 * The Song view's tunables (#709, epic #703 decision 1): the px-per-bar
 * scale and the frozen column's widths, the drag thresholds, and the per-kind
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
import type { Meter, SequencerKind, SequencerSpec } from '@windsor/engine';
import { TICKS_PER_BAR, meterBeats, ticksPerBar } from '@windsor/engine';
import { BASS_MODE_OPTIONS } from './bassModel';
import { divisorLabel } from './divisorLabels';
import { lineSummary } from './figureModel';
import { scheduleBars } from './figureProcessModel';
import { beatStarts } from './meterGrid';
import { ARP_STYLE_LABELS } from './sequencerKnobTables';

export interface SongViewScale {
  /** Px one bar spans on the ruler and in every lane, before any zoom: the song's bar, whatever its meter. */
  readonly pxPerBar: number;
  /** The zoom's absolute floor, under the fit (windsor#21): below it a long song in a narrow window scrolls. */
  readonly minPxPerBar: number;
  /** The zoom's ceiling: a sixteenth is still a comfortable drag target at this scale. */
  readonly maxPxPerBar: number;
  /** Px of vertical ruler drag that doubles (up) or halves (down) the scale. */
  readonly dragPxPerDoubling: number;
  /** The narrowest a ruler label's stretch may be; below it the labels thin to every 2nd, 4th… bar. */
  readonly minLabelPx: number;
  /**
   * The frozen column's number tab (windsor#534 decision 2): a strip in the
   * part's colour with its 1-based number, down the part's open lanes.
   */
  readonly partTabPx: number;
  /** The gap between the number tab and the part's rows. */
  readonly partTabGapPx: number;
  /** The padding each side of a part's row, inside the frozen column. */
  readonly partRowPadPx: number;
  /** The part row's first column: `▸` with the "n lanes" badge stacked under it. */
  readonly partFoldPx: number;
  /** The gap between that column and the mixer strip. */
  readonly partFoldGapPx: number;
  /**
   * The part's mixer strip in its row (windsor#157): Level and its value, M
   * and S on one line, collapsed, with S at the strip's right edge
   * (windsor#554, measured in Chrome).
   */
  readonly mixerWidthPx: number;
  /**
   * The expanded strip (windsor#158) besides its knobs: the Output select,
   * M and S and the gap between them, as
   * `console.css`'s `.mix-cell.expanded` sizes them.
   */
  readonly mixerExpandedBasePx: number;
  /** Each knob column of the expanded mixer, with the gap after it: a compact dial and a five-character value. */
  readonly mixerKnobColumnPx: number;
  /** The gap between the frozen column and the timeline. */
  readonly laneGapPx: number;
  /** A part's lane of regions, and the Harmony lane: one fixed height. */
  readonly partLanePx: number;
  /** The gap between two rows, in the frozen column and the timeline alike. */
  readonly rowGapPx: number;
  /** One automation lane's row under its part (windsor#348 decision 2): one fixed height. */
  readonly automationLanePx: number;
  /** The "+ Add lane" row after a part's lanes. */
  readonly automationAddRowPx: number;
  /**
   * A group member's inset in the frozen column (windsor#615 decision 4),
   * taken from its number tab so its fold and mixer strip stay in line with
   * every other row's. The folder's rail runs down the inset.
   */
  readonly folderIndentPx: number;
  /** The rail down a folder's left edge, from its header past its last member. */
  readonly folderRailPx: number;
}

export const SONG_VIEW: SongViewScale = {
  pxPerBar: 96,
  minPxPerBar: 8,
  maxPxPerBar: 768,
  dragPxPerDoubling: 60,
  minLabelPx: 28,
  partTabPx: 20,
  partTabGapPx: 4,
  partRowPadPx: 2,
  partFoldPx: 50,
  partFoldGapPx: 4,
  mixerWidthPx: 114,
  mixerExpandedBasePx: 135,
  mixerKnobColumnPx: 70,
  laneGapPx: 8,
  partLanePx: 40,
  rowGapPx: 4,
  automationLanePx: 56,
  automationAddRowPx: 30,
  folderIndentPx: 6,
  folderRailPx: 2,
};

/**
 * The mixer strip's width (windsor#158 decision 5): the collapsed strip's,
 * or expanded, the base plus one column a knob.
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

/** The scale's px the frozen column is built from. */
type ColumnScale = Pick<
  SongViewScale,
  | 'partTabPx'
  | 'partTabGapPx'
  | 'partRowPadPx'
  | 'partFoldPx'
  | 'partFoldGapPx'
  | 'mixerWidthPx'
  | 'mixerExpandedBasePx'
  | 'mixerKnobColumnPx'
>;

/**
 * Px from the frozen column's left edge to a part's mixer strip
 * (windsor#534): the number tab and its gap, the row's padding, the `▸`
 * column and its gap. The ruler row's header puts the strip's column
 * labels there too.
 */
export const mixerLeadPx = (scale: ColumnScale = SONG_VIEW): number =>
  scale.partTabPx +
  scale.partTabGapPx +
  scale.partRowPadPx +
  scale.partFoldPx +
  scale.partFoldGapPx;

/**
 * The one frozen column's width (windsor#534 decision 1): the lead, the
 * mixer strip, and the row's padding after it. Expanded, it grows by the
 * strip's knob columns (decision 6), so the timeline moves right with it.
 */
export const frozenColumnPx = (
  expanded: boolean,
  knobs: number,
  scale: ColumnScale = SONG_VIEW,
): number => mixerLeadPx(scale) + mixerColumnPx(expanded, knobs, scale) + scale.partRowPadPx;

/**
 * The CSS `left` of a line `bars` bars into the timeline, in the lanes'
 * own variables (`--frozen`, `--gap`, `--bar`): past the frozen column and
 * the gap after it (windsor#534). The playhead and the loop lines both read
 * it, so a zoom moves them with the regions and a column change moves both.
 */
export const timelineLeftCss = (bars: number): string =>
  `calc(var(--frozen) + var(--gap) + var(--bar) * ${bars})`;

/** What one row of a part's block in the frozen column holds. */
export type PartBlockRow = 'part' | 'lane' | 'add';

/**
 * The rows a part's block spans (windsor#534 decision 8): its own row and,
 * while it is folded open, a row per automation lane and the "+ Add lane"
 * row. The selection outline wraps them all and the number tab runs down
 * them; folded, both are the part's row alone.
 */
export const partBlockRows = (open: boolean, lanes: number): PartBlockRow[] =>
  open ? ['part', ...Array.from({ length: lanes }, (): PartBlockRow => 'lane'), 'add'] : ['part'];

/**
 * The slot whose block the outline wraps (windsor#534 decision 8): the
 * shared part selection (`ctx.parts.selected`), which the part strip
 * highlights too, whether or not the detail pane is open, so closing the
 * pane hides the pane and never the selection. Null when the document has
 * no such part.
 */
export const outlinedSlot = (shared: number, slots: readonly number[]): number | null =>
  slots.includes(shared) ? shared : null;

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

/**
 * Px from the song start for a tick — the playhead line's, a block's left
 * edge — where a bar of `bar` ticks (the song's, `ticksPerBar(meter)`,
 * windsor#430) spans `pxPerBar`.
 */
export const tickToPx = (tick: number, pxPerBar: number, bar: number = TICKS_PER_BAR): number =>
  (tick / bar) * pxPerBar;

/** The tick under a px offset from the song start (unsnapped; `regionModel.ts` snaps). */
export const pxToTick = (px: number, pxPerBar: number, bar: number = TICKS_PER_BAR): number =>
  (px / pxPerBar) * bar;

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

/**
 * The px offsets of the beat ticks inside one bar of `meter`, at its counted
 * beats (windsor#431; the first beat is the bar line itself): 7/8's fall at
 * ticks 24 and 48 of its 84.
 */
export const beatTickPx = (pxPerBar: number, meter?: Meter): number[] =>
  beatStarts(meterBeats(meter))
    .slice(1)
    .map((tick) => tickToPx(tick, pxPerBar, ticksPerBar(meter)));

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
export function blockBox(
  startTick: number,
  durationTicks: number,
  pxPerBar: number,
  bar: number = TICKS_PER_BAR,
): BlockBox {
  return {
    leftPx: tickToPx(startTick, pxPerBar, bar),
    widthPx: Math.max(MIN_BLOCK_PX, tickToPx(durationTicks, pxPerBar, bar) - BLOCK_GAP_PX),
  };
}

/** A block too narrow for its padding: drawn `.narrow`, so the CSS cannot widen it past its hit box. */
export const isNarrowBlock = (widthPx: number): boolean => widthPx < NARROW_BLOCK_PX;

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
  bar: number = TICKS_PER_BAR,
): number {
  const spanPx = tickToPx(span.durationTicks, pxPerBar, bar);
  const share = Math.min(1, Math.max(0, (px - box.leftPx) / Math.max(box.widthPx, spanPx)));
  return span.startTick + share * span.durationTicks;
}

export type LaneTone = 'pitch' | 'perc' | 'none';

/**
 * A kind's accent on its sequencer device (`DEVICE_ACCENT`, `--kc`): teal for
 * the pitched kinds, amber for Euclidean. It drives nothing else: since
 * windsor#642 a part's chip, number tab and regions take the part's own
 * colour (record `2026-10-07-part-colours`, decisions 7 and 11).
 */
export const LANE_TONE: Readonly<Record<SequencerKind, LaneTone>> = {
  none: 'none',
  euclidean: 'perc',
  grid: 'pitch',
  chord: 'pitch',
  arp: 'pitch',
  bass: 'pitch',
  figure: 'pitch',
  roll: 'pitch',
};

/** A part's name by slot, for a table that names another part (a Figure's leader, windsor#490). */
export type PartNames = (slot: number) => string | undefined;

/** The song's part names by slot. */
export const partNames =
  (doc: {
    readonly parts: readonly { readonly slot: number; readonly name: string }[];
  }): PartNames =>
  (slot) =>
    doc.parts.find((p) => p.slot === slot)?.name;

/**
 * One function per kind over that kind's own spec, the song's meter for a
 * table that names a step (windsor#431), and the parts' names for one that
 * names a part — the lanes look a part up here, never branch.
 */
export type KindTable<T> = {
  readonly [K in SequencerKind]: (
    spec: Extract<SequencerSpec, { kind: K }>,
    meter?: Meter,
    names?: PartNames,
  ) => T;
};

/** Apply a kind table to a spec; the cast is the discriminated union's, which TypeScript cannot correlate through an index. */
export function forKind<T>(
  table: KindTable<T>,
  spec: SequencerSpec,
  meter?: Meter,
  names?: PartNames,
): T {
  return (table[spec.kind] as (s: SequencerSpec, m?: Meter, n?: PartNames) => T)(
    spec,
    meter,
    names,
  );
}

const signedOffset = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** A Roll's loop in the meter's bars, to one decimal: `4`, `1.5`. */
const loopBars = (ticks: number, meter?: Meter): number =>
  Math.round((ticks / ticksPerBar(meter)) * 10) / 10;

/** The summary a region block shows in small caps, after the kind's name, its step named in the song's meter. */
export const REGION_SUMMARY: KindTable<string> = {
  none: () => 'no sequencer',
  euclidean: (spec, meter) =>
    `euclid ${spec.pulses.start}/${spec.steps} · ${divisorLabel(spec.divisor, meter)}`,
  grid: (spec, meter) => `grid · ${spec.length} steps · ${divisorLabel(spec.divisor, meter)}`,
  chord: (spec, meter) =>
    `chord · ${spec.steps.length} steps · ${divisorLabel(spec.divisor, meter)}`,
  arp: (spec, meter) =>
    `arp · ${ARP_STYLE_LABELS[spec.style]} ${divisorLabel(spec.divisor, meter)}`,
  bass: (spec) =>
    `bass · ${BASS_MODE_OPTIONS.find((o) => o.value === spec.pitchMode)?.label ?? spec.pitchMode}`,
  figure: (spec, meter, names) =>
    spec.source
      ? `figure ← ${names?.(spec.source.slot) ?? `slot ${spec.source.slot}`} ${signedOffset(spec.source.offset)}`
      : `figure · ${lineSummary(spec.cells, spec.length)} ${divisorLabel(spec.divisor, meter)}`,
  roll: (spec, meter) =>
    `roll · ${spec.notes.length} notes · ${loopBars(spec.loopTicks, meter)} bar loop`,
};

/**
 * The pattern's cycle in ticks, for the faint ticks inside a block (decision
 * 1): the loop length for a grid and a Basslead strip (windsor#371; a part
 * with no strip loads as one bar of plain notes), the steps' durations and
 * repeats for a Chord Player, `steps` for a Euclidean line, a Figure's
 * schedule in bars or else its line (windsor#490), a Roll's loop
 * (windsor#599); null for the kind that
 * has none (arp, a Figure canon) or a cycle with nothing in it.
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
  bass: (spec) => (spec.length > 0 ? spec.length * spec.divisor : null),
  figure: (spec, meter) => {
    // A canon plays its leader's line, so it has no cycle of its own to draw.
    if (spec.source) return null;
    const bars = scheduleBars(spec.schedule);
    if (bars > 0) return bars * ticksPerBar(meter);
    return spec.length > 0 ? spec.length * spec.divisor : null;
  },
  roll: (spec) => spec.loopTicks,
};
