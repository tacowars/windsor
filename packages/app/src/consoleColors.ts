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
  '--hot': HOT_COLOR,
  '--line': LINE_COLOR,
  '--line-bright': LINE_BRIGHT_COLOR,
};
