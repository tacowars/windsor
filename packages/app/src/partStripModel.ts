/**
 * The part strip's rules (windsor#520; record `2026-10-03-parts-tab-layout`,
 * decisions 2 and 3), pure so they are tested in Node: what a chip says and
 * which colour its edge takes (the part's own, windsor#642), when + and − are offered and what their
 * titles say, and where the chip row scrolls for ‹ ›, and to keep the
 * selected chip in view. `partStrip.ts` draws them.
 */
import type { DocumentPart } from '@windsor/engine';
import { MUSIC_PARTS_MAX } from '@windsor/engine';
import { partColor } from './consoleColors';
import { KIND_LABELS } from './sequencerConstants';

/** What one chip shows. */
export interface ChipLabel {
  /** The first line (the stylesheet sets it in capitals); the chip's `title` is this name in full. */
  readonly name: string;
  /** The second line: the 1-based position and the sequencer's label, `3 · Chord`. */
  readonly meta: string;
  /**
   * The part's colour (record `2026-10-07-part-colours`, decision 7): the
   * chip's left edge and its fill when selected, the ▾ list row's, the
   * number tab's and the regions'.
   */
  readonly tone: string;
}

/** The chip of the part at `index` (0-based) in the document's order, the Song tab's lane order. */
export function chipLabel(
  part: Pick<DocumentPart, 'name' | 'sequencer' | 'colour'>,
  index: number,
): ChipLabel {
  return {
    name: part.name,
    meta: `${index + 1} · ${KIND_LABELS[part.sequencer.kind]}`,
    tone: partColor(part.colour).hex,
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

/** What decides whether the chips fit, as the DOM measures it. */
export interface StripFit {
  /** How many chips the row holds. */
  readonly count: number;
  /** One chip's minimum width (`.pchip`'s `min-width`), in CSS px. */
  readonly chipMinPx: number;
  /** The gap between two chips (`.pscroll`'s `column-gap`), in CSS px. */
  readonly gapPx: number;
  /** The width the chips have with no overflow chrome shown: the strip less + and − and their gap. */
  readonly availablePx: number;
}

/**
 * The row overflows: its chips at their minimum width are wider than the
 * strip leaves them without ‹ › ▾ and the fades. Measured, never assumed
 * (record decision 9), and against the fitting layout rather than the
 * current one, so showing the overflow chrome never keeps it shown.
 */
export function chipsOverflow(fit: StripFit): boolean {
  const natural = fit.count * fit.chipMinPx + Math.max(0, fit.count - 1) * fit.gapPx;
  return natural > fit.availablePx + 1;
}

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
