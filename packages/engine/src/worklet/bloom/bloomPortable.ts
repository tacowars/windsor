/**
 * The e^x and the one-pole step bloom's modules build their coefficients
 * from, on the portable 2^x: the same bits on every platform (worklet rule
 * 6). V8's `Math.exp` differs by an ulp between its arm64 and x64 builds,
 * which would move the golden. The per-sample log2 and 2^x (the shared
 * compressor's static law, the generator's pitch, the envelope and the tone)
 * are `worklet/fm/portablePowers.ts`'s `log2InPlace` and `exp2InPlace`,
 * imported, never copied, so an edit there rebuilds this bundle too.
 *
 * Pinned through `inserts/bloomGolden.test.ts`, and against `Math` in
 * `bloomDsp.test.ts`.
 */
import { exp2 } from '../../inserts/tapePortableMath';

/** e^x for coefficient building (constructor or a rare reconfigure), by the portable 2^x. */
function bloomExp(x: number): number {
  return exp2(x * Math.LOG2E);
}

/** The one-pole step k = 1 − e^(−1/(rate·seconds)) of a smoother with time constant `seconds`. */
function bloomOnePoleStep(rate: number, seconds: number): number {
  return 1 - bloomExp(-1 / (rate * seconds));
}

export { bloomExp, bloomOnePoleStep };
