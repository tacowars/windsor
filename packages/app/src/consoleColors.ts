/**
 * The console's palette (#618): the one place a colour is spelled in TS. The
 * template's CSS custom properties carry the same values for the stylesheet
 * (`--carrier`, `--modulator`, `--return`, `--hot`, `--line`,
 * `--line-bright`), and `consoleColors.test.ts` holds the two in step — a
 * hue tuned in one place without the other fails there, not on a screen.
 */

/** Carriers, the percussion parts, the arrangement's controls, the scope trace. */
export const CARRIER_COLOR = '#E0A44E';
/** Modulators, the pitched parts, the mixer strips. */
export const MOD_COLOR = '#5FA8A0';
/** The return buses, in the mixer and the returns panel; the insert targets' automation lanes; the Euclid card's pitch lane. */
export const RETURN_COLOR = '#9C7BD0';
/** The sequencer targets' automation lanes and the knobs they lock (windsor#491). */
export const SEQ_LANE_COLOR = '#CC7A9C';
/** Clipping, and anything hot. */
export const HOT_COLOR = '#D2643C';
/** The panel rule: baselines, sustain guides, the scope's centre line. */
export const LINE_COLOR = '#2C3439';
/** The brighter rule: the envelope's release marker. */
export const LINE_BRIGHT_COLOR = '#3D4950';
/** The algorithm thumbnail's modulation links. */
export const ALG_LINK_COLOR = '#4A565C';
/** Ink drawn over an accent fill — a carrier's letter on its own box. */
export const INK_ON_ACCENT = '#14181A';

/** The role names the tabs use; the same two accents seen from the sequencer side. */
export const PERC_COLOR = CARRIER_COLOR;
export const PITCH_COLOR = MOD_COLOR;
export const STRIP_COLOR = MOD_COLOR;

/**
 * The Groups section's row accents (windsor#287), one per group in list
 * order and round again past the last: the palette's accents, the
 * modulator first so the first group never reads as a send bus beside it.
 */
export const GROUP_ACCENTS: readonly string[] = [MOD_COLOR, RETURN_COLOR, CARRIER_COLOR];

/** The accent of the group at `index` in the song's list. */
export const groupAccent = (index: number): string =>
  GROUP_ACCENTS[index % GROUP_ACCENTS.length] ?? MOD_COLOR;

/** The template's custom property each TS colour mirrors, for the equality test. */
export const CSS_VARIABLE_OF: Readonly<Record<string, string>> = {
  '--carrier': CARRIER_COLOR,
  '--modulator': MOD_COLOR,
  '--return': RETURN_COLOR,
  '--seq': SEQ_LANE_COLOR,
  '--hot': HOT_COLOR,
  '--line': LINE_COLOR,
  '--line-bright': LINE_BRIGHT_COLOR,
};

/** One entry of the part palette: the name the picker shows and its colour. */
export interface PartColor {
  readonly name: string;
  readonly hex: string;
}

/**
 * The part palette (windsor#642; record `2026-10-07-part-colours`, decisions
 * 5 and 6), in assignment order: a part's `colour` is an index into it, and
 * the engine's `PART_COLOURS` is its length. Each entry sits as far as the
 * palette allows from the three before it, and each is at least 12
 * CIEDE2000 from every one of the five accents above (carrier, modulator,
 * return, sequencer lane, hot), which the console keeps for its roles and
 * never gives a part.
 */
export const PART_COLORS: readonly PartColor[] = [
  { name: 'Sky', hex: '#6EA8E2' },
  { name: 'Lemon', hex: '#EDE36E' },
  { name: 'Raspberry', hex: '#BC3D6D' },
  { name: 'Umber', hex: '#8F7A55' },
  { name: 'Aqua', hex: '#6DE6FC' },
  { name: 'Lime', hex: '#77FB58' },
  { name: 'Magenta', hex: '#D65FC6' },
  { name: 'Frost', hex: '#E3DCE1' },
  { name: 'Steel', hex: '#5A7FBF' },
  { name: 'Grass', hex: '#669D42' },
  { name: 'Mint', hex: '#9EE6A8' },
  { name: 'Blush', hex: '#E2A2AA' },
  { name: 'Periwinkle', hex: '#A6AAF2' },
  { name: 'Olive', hex: '#ABBD3B' },
];

/**
 * The palette entry a part's `colour` names. The normaliser keeps every
 * part's colour in range, so the first entry stands in only for a value
 * that never reaches here.
 */
export const partColor = (colour: number): PartColor =>
  PART_COLORS[colour] ?? (PART_COLORS[0] as PartColor);
