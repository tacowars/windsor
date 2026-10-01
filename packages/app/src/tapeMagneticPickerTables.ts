/**
 * The Tape card's hidden magnetic picker (windsor#276): the page flag that
 * shows it, and its words. Developer-only, for auditioning the allowed core
 * points per tape model on a preview; never saved.
 */
import type { TapeMagneticRow } from '@windsor/engine';

/** The URL query parameter that shows the picker, with any value or none: `?tapeDev`. */
export const TAPE_DEV_FLAG = 'tapeDev';

/** The picker's label. */
export const TAPE_MAGNETIC_PICKER_LABEL = 'Core point (dev)';

/** The picker's hint: what it does and that it is not saved. */
export const TAPE_MAGNETIC_PICKER_HINT =
  'Audition the magnetic core at an allowed point (drive / width / saturation). Not saved: a reload gives the model row back.';

/** The first option, the model's own `TAPE_MODELS` row; its value is the empty string. */
export const TAPE_MODEL_ROW_LABEL = 'Model row';

/** Decimals in an option's `drive / width / saturation` label. */
export const TAPE_MAGNETIC_DECIMALS = 2;

/**
 * The corner the corner-accuracy record finds least accurate
 * (`docs/research/2026-09-30-tape-corner-accuracy/README.md`), and its mark.
 */
export const TAPE_MAGNETIC_LEAST_ACCURATE: TapeMagneticRow = [1, 0, 1];
export const TAPE_MAGNETIC_LEAST_ACCURATE_NOTE = '(least accurate on bright material)';

/** Said when a point is chosen while the audio is off, so there is no live insert to send it to. */
export const TAPE_MAGNETIC_NO_AUDIO = 'Turn the audio on to audition a core point.';
