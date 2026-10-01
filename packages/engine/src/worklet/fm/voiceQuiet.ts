/**
 * When a voice has nothing left to hear (#547, windsor#7): `voiceDormant`,
 * a gated voice the part may skip, `voiceFinished`, a released voice that
 * may end, `voiceHoldsEndLevel`, one that never goes quiet and is faded out,
 * and `voiceFilterQuiet`, the filter and drive state both need. Functions
 * over the voice, read by its `dormant` and `finished` getters and its
 * `settle` at control boundaries (moved out of `voice.ts` when windsor#301's
 * knot rows took it past its size). Invariant: reads only, allocation free.
 * `fmProcessorDormancy.test.ts` pins dormancy and the lifecycle, and
 * `fmProcessor.test.ts` the ending of released and held-level voices.
 */

import type { Voice } from './voice';
import { ST_SUSTAIN } from './envelope';
import { DORMANT_AMP, DORMANT_FILTER_STATE } from './fmConstants';
import { FILT_OFF } from './modeIds';
import { Svf } from './svf';

/**
 * Dormant (#547): gated, every carrier held in sustain at level 0 with an
 * `endLevel` of 0, its amplitude ramp at ~0 and any filter no longer ringing.
 * The part skips its control and render work; nothing it would have rendered
 * is audible. Skipping freezes the pitch, filter and LFO state too, so the
 * end-level condition matters: a release rising to a non-zero end level is
 * sound, and would be heard from that frozen state. Excluding it means a
 * dormant voice's note-off is silence, and the voice can simply end. Read at
 * control boundaries, so a live retune that raises a sustain wakes the voice
 * from its frozen state with the ordinary amplitude ramp up from ~0.
 */
function voiceDormant(voice: Voice): boolean {
  if (!voice.gate || voice.fadeInc !== 0) return false;
  const carriers = voice.alg.carriers;
  for (let c = 0; c < carriers.length; c++) {
    const i = carriers[c];
    const env = voice.ampEnv[i];
    if (env.state !== ST_SUSTAIN || env.p!.sustainLevel !== 0) return false;
    if (env.p!.endLevel !== 0) return false;
    if (Math.abs(voice.amp[i]) > DORMANT_AMP) return false;
  }
  return voiceFilterQuiet(voice);
}

/**
 * The filter is off, or has stopped ringing: both stages under the dormancy
 * floor (#547), and the drive's tone pole too (windsor#300), which holds no
 * state while it is not running.
 */
function voiceFilterQuiet(voice: Voice): boolean {
  if (Math.abs(voice.drive.toneState) > DORMANT_FILTER_STATE) return false;
  const f = voice.patch!.filter;
  if (f.mode === FILT_OFF) return true;
  if (!Svf.quiet(voice.svfA)) return false;
  return !f.slope24 || Svf.quiet(voice.svfB);
}

/**
 * Nothing left to hear: every carrier's envelope has ended, its amplitude
 * ramp has reached ~0 and the filter has stopped ringing. Ending a voice on
 * the envelopes alone skipped the last ramp and cut a resonant filter's
 * ring to 0 in one sample, the click at the end of a stop's release
 * (windsor#7).
 */
function voiceFinished(voice: Voice): boolean {
  const carriers = voice.alg.carriers;
  for (let i = 0; i < carriers.length; i++) {
    const c = carriers[i];
    if (!voice.ampEnv[c].finished) return false;
    if (Math.abs(voice.amp[c]) > DORMANT_AMP) return false;
  }
  return voiceFilterQuiet(voice);
}

/**
 * Every carrier's envelope has ended, and at least one ended above 0 (an
 * End level): the voice holds that level for good and never goes quiet, so
 * the part fades it out with `steal` rather than waiting on it or cutting
 * it (windsor#7). Reads the envelopes, not the amplitude ramps.
 */
function voiceHoldsEndLevel(voice: Voice): boolean {
  const carriers = voice.alg.carriers;
  let holds = false;
  for (let i = 0; i < carriers.length; i++) {
    const env = voice.ampEnv[carriers[i]];
    if (!env.finished) return false;
    if (Math.abs(env.value) > DORMANT_AMP) holds = true;
  }
  return holds;
}

export { voiceDormant, voiceFilterQuiet, voiceFinished, voiceHoldsEndLevel };
