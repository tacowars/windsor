/**
 * The MIDI CC panel's tunables (windsor#784, record `2026-10-13-midi-cc-mapping`
 * and its mockup).
 */

/** How long a row learn has just committed reads "Heard CC 74 · ch 1 · <device>", lit. */
export const CC_HEARD_MS = 1600;

/** How long a row "Edit mapping…" opened the panel at stays lit. */
export const CC_ROW_FLASH_MS = 1200;

/** The gap between the part bar (or the tab's top) and the popover under it, as drawn. */
export const CC_POP_GAP_PX = 6;

/** A mapping's channels, 1 to this, as MIDI 1.0 numbers them (the engine's `CC_CHANNEL_MAX`). */
export const CC_CHANNELS = 16;
