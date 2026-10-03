/**
 * The part strip's tunables (windsor#520; record `2026-10-03-parts-tab-layout`,
 * decisions 2 and 3). The chips' 70–150 px width is the stylesheet's alone
 * (`console.css`, `.pchip`); what the scroll maths needs lives here and
 * reaches the stylesheet as a custom property, so the two never drift.
 */
export interface PartStripTable {
  /** The width of each faded edge while the strip overflows, in CSS px (the mockup's 22 px). */
  readonly fadePx: number;
}

export const PART_STRIP: PartStripTable = {
  fadePx: 22,
};
