/**
 * The Tape insert's developer override message (windsor#276): the main
 * thread's `setTapeMagneticOverride` posts it, and the Tape processor hands
 * its row to `TapeMagneticStage.setOverride`. A row replaces the model's
 * `[drive, width, saturation]` for that one insert until a `null` row puts
 * the model's row back. It is live only: never in the spec, the song or the
 * patch.
 *
 * Import-free, because the worklet bundle carries it and the bundle does no
 * tree shaking.
 */
export const TAPE_MAGNETIC_OVERRIDE = 'magneticOverride';

export interface TapeMagneticOverrideMessage {
  readonly type: typeof TAPE_MAGNETIC_OVERRIDE;
  /** `[drive, width, saturation]`, or `null` for the model's own row. */
  readonly row: readonly [number, number, number] | null;
}
