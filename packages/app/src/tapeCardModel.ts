/** The Tape card's pure edits, testable without the DOM (windsor#246). */
import { TAPE_OVERSAMPLING, type TapeSpec } from '@windsor/engine';

/**
 * `spec` with the Oversampling picker's `value` (`'2'` or `'4'`) committed as
 * `spec.oversampling`; `spec` itself when the value is not a factor the
 * engine builds.
 */
export function withOversampling(spec: TapeSpec, value: string): TapeSpec {
  const factor = TAPE_OVERSAMPLING.find((f) => String(f) === value);
  return factor === undefined ? spec : { ...spec, oversampling: factor };
}
