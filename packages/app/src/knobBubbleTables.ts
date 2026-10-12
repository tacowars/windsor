/**
 * The compact knob's value bubble (windsor#768 decision 6; the approved
 * mockup `docs/design/song-mixer-mockup.html`, values option A): when it
 * shows and hides, and where it sits above the dial.
 */

/** When the bubble shows and hides, in ms. */
export interface KnobBubbleTiming {
  /** A hover this long shows it. */
  readonly hoverMs: number;
  /** It hides this long after the pointer leaves the knob. */
  readonly leaveMs: number;
  /** It hides this long after a release that leaves the pointer off the knob. */
  readonly releaseMs: number;
  /** A double-click's reset shows it for this long. */
  readonly resetMs: number;
}

export const KNOB_BUBBLE_TIMING: KnobBubbleTiming = {
  hoverMs: 350,
  leaveMs: 150,
  releaseMs: 700,
  resetMs: 900,
};

/** Where the bubble sits, in px. */
export interface KnobBubbleGeometry {
  /** Between the bubble's bottom edge and the dial's top. */
  readonly gapPx: number;
  /** The least room it keeps from the window's left and right edges. */
  readonly marginPx: number;
}

export const KNOB_BUBBLE_PX: KnobBubbleGeometry = {
  gapPx: 6,
  marginPx: 4,
};
