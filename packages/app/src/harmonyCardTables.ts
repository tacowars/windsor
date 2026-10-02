/**
 * The harmony card's sizes (windsor#332): the card is a sequencer device's
 * height, so a chord's card and a part's device read as one row in the Song
 * pane. As `sequencerDevice.ts` does with `SEQUENCER_DEVICE_PX`,
 * `harmonyCard.ts` sets each entry on the card's root as a CSS custom
 * property and `console.css` reads it, so every number is written once, here.
 */
import { SEQUENCER_DEVICE_H_PX } from './sequencerDeviceTables';

/** Custom property → px. */
export const HARMONY_CARD_PX: Readonly<Record<string, number>> = {
  /** The card's height: a sequencer device's, from the one table that owns it. */
  '--seq-h': SEQUENCER_DEVICE_H_PX,
  /** The card's width cap, the ▶ row's and the chips' with it. */
  '--harmony-w': 640,
  /** The space between two ▶s, and between two chips. */
  '--harmony-col-gap': 3,
  /** The space between the ▶ row and the chips. */
  '--harmony-play-gap': 3,
  /** A ▶'s height. */
  '--harmony-play-h': 28,
  /** The ▶ icon's height; its width follows the icon's own shape. */
  '--harmony-play-icon': 13,
  /** A degree chip's height: the numeral over the pitch name. */
  '--harmony-chip-h': 60,
  /** A chip's numeral. */
  '--harmony-chip-numeral': 14,
  /** A chip's pitch name in the key. */
  '--harmony-chip-pitch': 12,
  /** The Accidental and Size segments', the Quality select's and Delete's height. */
  '--harmony-control-h': 28,
  /** The Size segment's, the Quality select's and Delete's text. */
  '--harmony-control-text': 12,
  /** The Accidental segment's ♭ ♮ ♯. */
  '--harmony-acc-text': 16,
  /** An Accidental button's width. */
  '--harmony-acc-w': 38,
  /** A Size button's width. */
  '--harmony-size-w': 72,
  /** The Quality select's width. */
  '--harmony-quality-w': 150,
  /** The field labels: Degree, Accidental, Size, Quality. */
  '--harmony-label-text': 10,
  /** The info bubble's chord name. */
  '--harmony-info-name': 14,
  /** The info bubble's numeral and size line. */
  '--harmony-info-sub': 12,
  /** The bottom row's height: the Duration dial's, so the last chord's card, with a hint for a dial, lays out as every other. */
  '--harmony-foot-h': 72,
  /** The info bubble's narrowest width. */
  '--harmony-info-w': 170,
};
