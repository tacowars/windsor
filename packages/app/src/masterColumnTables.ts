/**
 * The Mixer tab's master column (windsor#194 decisions 1, 2, 7 and 8; the
 * mockup's option B, `docs/research/2026-09-30-master-output/mockup.html`):
 * its width and gap, where it stacks, the meters' height and channel width,
 * the fader's width, and the transfer curve's range. `mixerTab.ts` and
 * `masterColumn.ts` write the widths as custom properties; the stacking
 * width is also `console.css`'s media query, which `masterColumnTables.test.ts`
 * pins to this table.
 */

/** The column's width, and the gap between it and the racks, in CSS pixels. */
export const MASTER_COLUMN_WIDTH_PX = 260;
export const MASTER_COLUMN_GAP_PX = 14;

/** At this width and below, the column stacks above the racks and stops being sticky. */
export const MASTER_STACK_MAX_WIDTH_PX = 760;

/** How far below the sticky header the column and the bridge sit. */
export const MASTER_STICKY_GAP_PX = 8;

/** The column's meters: their height, and each channel's width. */
export const MASTER_METER_HEIGHT_PX = 210;
export const MASTER_CHANNEL_WIDTH_PX = 32;

/** The Level fader's column width, and its cap's height (the cap is the track's width). */
export const LEVEL_FADER_WIDTH_PX = 34;
export const LEVEL_FADER_CAP_HEIGHT_PX = 14;
/** The linear level's decimals in the slider's `aria-valuenow`. */
export const LEVEL_FADER_VALUE_DECIMALS = 3;

/**
 * The transfer curve: a `sizePx` square SVG over a `viewBox` of `view` units,
 * `minDb` to `maxDb` on both axes, sampled every `stepDb`, with grid lines at
 * `gridDb`, and the input-peak dot's radius.
 */
export const TRANSFER_CURVE = {
  sizePx: 96,
  view: 100,
  minDb: -24,
  maxDb: 6,
  stepDb: 0.5,
  gridDb: [-18, -12, -6] as readonly number[],
  dotRadius: 3.2,
  /** Where the axis names sit, in view units. */
  inLabel: { x: 97, y: 96 },
  outLabel: { x: 4, y: 9 },
} as const;
export type TransferCurveTable = typeof TRANSFER_CURVE;

/** A dot or a path point is written to this many decimals, in view units. */
export const TRANSFER_DECIMALS = 1;
