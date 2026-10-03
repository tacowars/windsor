/**
 * The part strip's rules (windsor#520; record `2026-10-03-parts-tab-layout`,
 * decisions 2 and 3), pure so they are tested in Node: what a chip says and
 * which colour its edge takes, when + and − are offered and what their
 * titles say, and where the chip row scrolls for ‹ ›, and to keep the
 * selected chip in view. `partStrip.ts` draws them.
 */
import type { MusicPart } from '@windsor/engine';
import { MUSIC_PARTS_MAX } from '@windsor/engine';
import { KIND_LABELS } from './sequencerConstants';
import type { LaneTone } from './songViewTables';
import { LANE_TONE } from './songViewTables';

/** What one chip shows. */
export interface ChipLabel {
  /** The first line (the stylesheet sets it in capitals); the chip's `title` is this name in full. */
  readonly name: string;
  /** The second line: the 1-based position and the sequencer's label, `3 · Chord`. */
  readonly meta: string;
  /** The left edge: the colour the Song tab draws this part's regions in. */
  readonly tone: string;
}

/** The region colours `.reg` and `.reg.perc` draw in (`console.css`), by lane tone. */
const REGION_TONE: Readonly<Record<LaneTone, string>> = {
  perc: 'var(--carrier)',
  pitch: 'var(--modulator)',
  none: 'var(--modulator)',
};

/** The chip of the part at `index` (0-based) in the document's order, the Song tab's lane order. */
export function chipLabel(part: Pick<MusicPart, 'name' | 'sequencer'>, index: number): ChipLabel {
  const kind = part.sequencer.kind;
  return {
    name: part.name,
    meta: `${index + 1} · ${KIND_LABELS[kind]}`,
    tone: REGION_TONE[LANE_TONE[kind]],
  };
}

/** + is offered below the song's part limit. */
export const canAddPart = (count: number, max: number = MUSIC_PARTS_MAX): boolean => count < max;

/** − is offered while another part would be left. */
export const canRemovePart = (count: number): boolean => count > 1;

export const addPartTitle = (count: number, max: number = MUSIC_PARTS_MAX): string =>
  `Add a part (${count} of ${max})`;

export const removePartTitle = (name: string): string => `Remove ${name}…`;

/** The chip row's scroll box, as the DOM measures it. */
export interface ScrollBox {
  readonly scrollLeft: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
}

/** The row overflows: its chips are wider than the box. Measured, never assumed (record decision 9). */
export const overflows = (box: Pick<ScrollBox, 'clientWidth' | 'scrollWidth'>): boolean =>
  box.scrollWidth > box.clientWidth + 1;

const clampScroll = (box: ScrollBox, left: number): number =>
  Math.min(Math.max(0, box.scrollWidth - box.clientWidth), Math.max(0, left));

/**
 * Where ‹ (`direction` -1) or › (+1) scrolls the row: a page, the box's
 * width less the two faded edges, so the chip half under a fade is whole
 * after the step; clamped to the row's ends.
 */
export function pageScrollTarget(box: ScrollBox, direction: -1 | 1, fadePx: number): number {
  const page = Math.max(1, box.clientWidth - 2 * fadePx);
  return clampScroll(box, box.scrollLeft + direction * page);
}

/**
 * The scroll that shows the chip spanning `left` to `left + width` (offsets
 * in the row's content) clear of the faded edges: unchanged when it already
 * is, else the least move that brings it in.
 */
export function revealScrollLeft(
  box: ScrollBox,
  chip: { readonly left: number; readonly width: number },
  fadePx: number,
): number {
  const start = chip.left - fadePx;
  const end = chip.left + chip.width + fadePx;
  if (start < box.scrollLeft) return clampScroll(box, start);
  if (end > box.scrollLeft + box.clientWidth) return clampScroll(box, end - box.clientWidth);
  return box.scrollLeft;
}
