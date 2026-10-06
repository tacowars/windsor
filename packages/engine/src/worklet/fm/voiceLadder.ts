/**
 * The Acid Ladder on the voice (windsor#573, record
 * `2026-10-04-acid-ladder-filter-mode` decisions 4–8): its control-rate
 * half, as `voiceFormant.ts` is the Formant's, where `updateVoiceLadder`
 * hands the voice's live Reso to the ladder and tunes it through
 * `tuneLadder` (`ladderTune.ts`, which the filter insert shares); and
 * `renderVoiceLadder`, its pass over a render chunk after the sample loop.
 *
 * `updateVoiceFilter` (`voiceControl.ts`) works the cutoff out as the
 * serial modes' (the live cutoff, a lane's or a step's included, times
 * `2^octaves` of the envelope, wheel, both LFOs and key track) and leaves it
 * in the ladder's `cutoffHz` before it calls `updateVoiceLadder`.
 *
 * Invariants: the update runs once per control block and the pass once per
 * render chunk, never per sample; both allocate nothing, and no double
 * crosses a call (worklet rule 2): the cutoff and the Reso arrive in the
 * ladder's fields, a sample passes through its `point`, and the sample
 * rate is an integer. Both render loops call the same pass, so they stay
 * bit-identical by construction. `synth/fmProcessorFilterLadder.test.ts`
 * pins the voice's ladder, and `fmProcessorKernel.test.ts` the two loops.
 */

import type { Voice } from './voice';
import { tuneLadder } from './ladderTune';
import { VT_RESONANCE } from './voiceTargetTables';

/** This block's ladder: the live Reso onto it, `cutoffHz` already set, then `tuneLadder`. Allocates nothing. */
function updateVoiceLadder(voice: Voice): void {
  const ladder = voice.ladder;
  ladder.resonance = voice.liveValues[VT_RESONANCE];
  tuneLadder(ladder, voice.sr);
}

/**
 * The Acid mode's half of a render chunk, after either render loop: each
 * of the chunk's `n` samples the loop left in the ladder's `chunk` through the
 * ladder, then the steal fade from the chunk's start, as the loop runs it
 * after its filter, and the pan, added into the part's accumulators from
 * `off`. The loop ran its own fade on a 0 in the ladder's place and stores
 * it after this, so the fade read here is the chunk's first. One call a
 * chunk: a call left in the sample loop cost every mode's voices about
 * 1.5 ns a sample once an Acid voice had played, as V8 spilled the loop's
 * doubles around it (`docs/research/2026-10-04-acid-ladder-filter/`).
 * Allocates nothing; the ladder's sample passes through its `point`.
 */
function renderVoiceLadder(
  voice: Voice,
  outL: Float32Array,
  outR: Float32Array,
  off: number,
  n: number,
): void {
  const ladder = voice.ladder;
  const input = ladder.chunk;
  const panL = voice.panL,
    panR = voice.panR;
  const fadeInc = voice.fadeInc;
  let fade = voice.fade;
  for (let s = 0; s < n; s++) {
    ladder.point = input[s];
    ladder.process();
    let sig = ladder.point;
    if (fadeInc !== 0) {
      fade += fadeInc;
      if (fade <= 0) {
        fade = 0;
      }
      sig *= fade;
    }
    const k = off + s;
    outL[k] += sig * panL;
    outR[k] += sig * panR;
  }
}

export { renderVoiceLadder, updateVoiceLadder };
