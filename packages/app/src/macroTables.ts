/**
 * The Macros card's data (windsor#561, record `2026-10-04-patch-macro-knobs`
 * decision 11; the mockup `docs/design/macro-knobs-mockup.html`, layout A, is
 * the spec): its sizes, set on the card as CSS custom properties the way
 * `harmonyCard.ts` sets `HARMONY_CARD_PX`, so every number is written once and
 * scales with the page's zoom; the words it shows; and each curve's segment
 * label and glyph.
 */
import type { MACRO_CURVE_NAMES } from '@windsor/engine';

/** Custom property → px. */
export const MACRO_CARD_PX: Readonly<Record<string, number>> = {
  /** A macro tile's width. */
  '--macro-tile-w': 132,
  /** The selected tile's top rule. */
  '--macro-tile-rule': 2,
  /** A mapping row's target column: name, group and what it plays. */
  '--macro-target-w': 180,
  /** A mapping row's Min and Max columns: one knob each. */
  '--macro-knob-w': 54,
  /** The curve glyph. */
  '--macro-glyph-w': 28,
  '--macro-glyph-h': 20,
  /** The curve segment's widest. */
  '--macro-seg-w': 190,
  /** The target picker's width. */
  '--macro-picker-w': 560,
};

/** The name a new macro takes: this and the lowest number no macro of the patch is named with. */
export const MACRO_NAME_PREFIX = 'Macro';

/** The hint beside `+ Add mapping` (decision 4), word for word. */
export const ADD_MAPPING_HINT =
  "A new mapping starts with Min and Max at the target's current value, so nothing changes until a knob moves.";

/**
 * The picker's group labels drop the lane picker's `Voice · ` (the mockup
 * heads them Filter, Op A, LFO, Pitch); a mapping row's group line keeps it.
 */
export const PICKER_GROUP_PREFIX = 'Voice · ';

/** Each curve's segment label, by `MACRO_CURVE_NAMES` entry: `Lin Exp Log S`. */
export const CURVE_SEGMENT_LABELS: Readonly<Record<(typeof MACRO_CURVE_NAMES)[number], string>> = {
  Linear: 'Lin',
  Exp: 'Exp',
  Log: 'Log',
  S: 'S',
};

/** The glyph's box, in its own units: a 28 × 20 view box with a 2-unit margin. */
export const CURVE_GLYPH_BOX = { w: 28, h: 20, inset: 2 } as const;

/** Each curve's glyph path inside `CURVE_GLYPH_BOX`, by `MACRO_CURVE_NAMES` entry; mirrored when inverted. */
export const CURVE_GLYPH_PATHS: Readonly<Record<(typeof MACRO_CURVE_NAMES)[number], string>> = {
  Linear: 'M2 18 L26 2',
  Exp: 'M2 18 C 14 18 20 14 26 2',
  Log: 'M2 18 C 8 6 14 2 26 2',
  S: 'M2 18 C 14 18 14 2 26 2',
};
