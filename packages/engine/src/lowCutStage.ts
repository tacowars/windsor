/**
 * A channel strip's low cut (#640): one highpass `BiquadFilterNode`, always
 * the strip's first stage, so the sends carry the cut signal as a desk's
 * channel HPF would (the strip chain, #639).
 *
 * Always built, never bypassed by re-wiring: `connect` / `disconnect` land on
 * a render-quantum boundary and click on a sustaining part. At the range's
 * floor (`LOW_CUT_MIN_HZ`) it sits below the music bus's own 30 Hz highpass,
 * so "off" is inaudible rather than absent — the stated trade.
 *
 * Butterworth, so flat above the cutoff: the spec reads `Q` in dB for a
 * highpass, hence `BUTTERWORTH_Q_DB` and not 0.707.
 */
import { BUTTERWORTH_Q_DB } from './audioConstants';
import type { StripStage } from './channelStrip';

export interface LowCutStage extends StripStage {
  readonly filter: BiquadFilterNode;
  /** Hz; the caller clamps (`deskNormalise.ts`, `deskApply.ts`). */
  setFrequency(hz: number): void;
}

export function createLowCutStage(context: BaseAudioContext, hz: number): LowCutStage {
  const filter = context.createBiquadFilter();
  filter.type = 'highpass';
  filter.Q.value = BUTTERWORTH_Q_DB;
  filter.frequency.value = hz;
  return {
    input: filter,
    output: filter,
    filter,
    setFrequency(next: number): void {
      filter.frequency.value = next;
    },
    // One node, no edges of its own: the strip removes the ones into and out of it.
    dispose(): void {},
  };
}
