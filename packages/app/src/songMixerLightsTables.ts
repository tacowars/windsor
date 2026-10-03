/**
 * The mixer lights (windsor#159, windsor#528): how a part's meter
 * becomes the green activity light's brightness, the two colours that light
 * runs between, and how many meter reports a clear waits out. The logic is
 * `songMixerLightsModel.ts`; the red clip light's colour is the stylesheet's
 * `--hot`, since it is only ever dark or lit.
 */

/** An sRGB colour as its three 0–255 channels, so the model can mix two. */
export type Rgb = readonly [number, number, number];

export interface MixerLightTable {
  /** At or below this peak (dBFS) the green light is dark. */
  readonly floorDb: number;
  /**
   * The exponent over the peak's place between the floor and 0 dBFS:
   * 1 is linear in dB, above 1 holds quiet parts dimmer.
   */
  readonly curve: number;
  /**
   * How many brightnesses the light is drawn at between dark and lit. A
   * light is repainted only when its step moves, so this bounds the DOM
   * writes as well as the look.
   */
  readonly steps: number;
  /** The green light unlit: a part that is silent, muted or not playing. */
  readonly darkColor: Rgb;
  /** The green light at 0 dBFS. */
  readonly litColor: Rgb;
  /**
   * Meter reports after a clear whose overload is ignored: the one the
   * worklet may have posted before it saw the reset, still in flight.
   */
  readonly staleReports: number;
}

export const MIXER_LIGHTS: MixerLightTable = {
  floorDb: -60,
  curve: 1,
  steps: 16,
  darkColor: [30, 40, 34],
  litColor: [96, 214, 120],
  staleReports: 1,
};

/** The red light's title, lit and dark, as windsor#159 words it: the mixer's and the chips'. */
export const CLIP_TITLES = {
  lit: 'Clipped: click to clear',
  dark: 'Not clipped',
} as const;
