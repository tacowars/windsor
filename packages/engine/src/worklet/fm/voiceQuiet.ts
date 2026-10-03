/**
 * When a voice has nothing left to hear (#547, windsor#7): `voiceDormant`,
 * a gated voice the part may skip, `voiceFinished`, a released voice that
 * may end, `voiceHoldsEndLevel`, one that never goes quiet and is faded out,
 * and `voiceFilterQuiet`, the filter and drive state both need. Functions
 * over the voice, read by its `dormant` and `finished` getters and its
 * `settle`, and through them by the part's note-off, dormancy skip and voice
 * allocation (moved out of `voice.ts` when windsor#301's knot rows took it
 * past its size). Invariant: reads only, allocation free, and every read of
 * an operator envelope's stage goes through `heardStage`, which waits for
 * the knots still ahead of the render. `fmProcessorDormancy.test.ts` pins
 * dormancy and the lifecycle, `fmProcessor.test.ts` the ending of released
 * and held-level voices, and `fmProcessorEnvelopeEdges.test.ts` a split
 * render against an unsplit one and that no other module reads the stage.
 */

import type { Voice } from './voice';
import { ST_DONE, ST_IDLE, ST_SUSTAIN } from './envelope';
import { DORMANT_AMP, DORMANT_FILTER_STATE } from './fmConstants';
import { FILT_FORMANT, FILT_OFF } from './modeIds';
import { Svf } from './svf';

/** `heardStage` while a knot of this block is still ahead of the render: no stage of the envelope's. */
const ST_IN_FLIGHT = -1;

/**
 * The stage operator `i`'s envelope is heard in (windsor#301). Each control
 * block advances the envelope to the block's end at once (`advanceExact`),
 * so its own stage can run ahead of the render: a Trigger hit can finish
 * there, or a decay reach its sustain, while the amplitude ramp still has
 * knots to pass. Until the last of them the render is still inside a
 * segment the envelope has left, and this reads `ST_IN_FLIGHT`; after it,
 * the envelope's stage. An event that splits the block makes the voice's
 * end-state reads mid-block, so every one of them reads this and never the
 * envelope's `state` or `finished`. The knot state decides, not the level:
 * a flat attack sits at 0 until its rise. An edge that rounds to the
 * block's end is no knot, so its stage reads from the block's start: the
 * end-of-voice reads also need the ramp under `DORMANT_AMP`, and a held End
 * level's fade waits for the quantum's end, past the edge (windsor#323).
 */
function heardStage(voice: Voice, i: number): number {
  if (voice.ampBreak[i] !== 0) return ST_IN_FLIGHT;
  return voice.ampEnv[i].state;
}

/** Operator `i`'s envelope has ended and the render has passed its last knot. */
function envelopeAtRest(voice: Voice, i: number): boolean {
  const stage = heardStage(voice, i);
  return stage === ST_DONE || stage === ST_IDLE;
}

/**
 * Dormant (#547): gated, every carrier heard in sustain at level 0 with an
 * `endLevel` of 0, its amplitude ramp at ~0 and any filter no longer ringing.
 * The part skips its control and render work; nothing it would have rendered
 * is audible. Skipping freezes the pitch, filter and LFO state too, so the
 * end-level condition matters: a release rising to a non-zero end level is
 * sound, and would be heard from that frozen state. Excluding it means a
 * dormant voice's note-off is silence, and the voice can simply end. Read at
 * control boundaries and at a note-off, so a live retune that raises a
 * sustain wakes the voice from its frozen state with the ordinary amplitude
 * ramp up from ~0.
 */
function voiceDormant(voice: Voice): boolean {
  if (!voice.gate || voice.fadeInc !== 0) return false;
  const carriers = voice.alg.carriers;
  for (let c = 0; c < carriers.length; c++) {
    const i = carriers[c];
    const p = voice.ampEnv[i].p!;
    if (heardStage(voice, i) !== ST_SUSTAIN || p.sustainLevel !== 0) return false;
    if (p.endLevel !== 0) return false;
    if (Math.abs(voice.amp[i]) > DORMANT_AMP) return false;
  }
  return voiceFilterQuiet(voice);
}

/**
 * The filter is off, or has stopped ringing: every stage it runs (one or two,
 * or the Formant mode's three) under the dormancy
 * floor (#547), and the drive's tone pole too (windsor#300), which holds no
 * state while it is not running.
 */
function voiceFilterQuiet(voice: Voice): boolean {
  if (Math.abs(voice.drive.toneState) > DORMANT_FILTER_STATE) return false;
  const f = voice.patch!.filter;
  if (f.mode === FILT_OFF) return true;
  if (!Svf.quiet(voice.svfA)) return false;
  // Formant's three peaks all run, whatever `slope24` says (windsor#331).
  if (f.mode === FILT_FORMANT) return Svf.quiet(voice.svfB) && Svf.quiet(voice.svfC);
  return !f.slope24 || Svf.quiet(voice.svfB);
}

/**
 * Nothing left to hear: every carrier's envelope is at rest, its amplitude
 * ramp has reached ~0, and the filter has stopped ringing. Ending a voice on
 * the envelopes alone skipped the last ramp and cut a resonant filter's ring
 * to 0 in one sample, the click at the end of a stop's release (windsor#7).
 */
function voiceFinished(voice: Voice): boolean {
  const carriers = voice.alg.carriers;
  for (let i = 0; i < carriers.length; i++) {
    const c = carriers[i];
    if (!envelopeAtRest(voice, c)) return false;
    if (Math.abs(voice.amp[c]) > DORMANT_AMP) return false;
  }
  return voiceFilterQuiet(voice);
}

/**
 * Every carrier's envelope is at rest, and at least one ended above 0 (an
 * End level): the voice holds that level for good and never goes quiet, so
 * the part fades it out with `steal` rather than waiting on it or cutting
 * it (windsor#7). Reads the envelopes' end levels, not the amplitude ramps;
 * a hit still on its way to that level is not faded early (windsor#301).
 * `settle` reads it at the quantum's end alone (windsor#323).
 */
function voiceHoldsEndLevel(voice: Voice): boolean {
  const carriers = voice.alg.carriers;
  let holds = false;
  for (let i = 0; i < carriers.length; i++) {
    const c = carriers[i];
    if (!envelopeAtRest(voice, c)) return false;
    if (Math.abs(voice.ampEnv[c].value) > DORMANT_AMP) holds = true;
  }
  return holds;
}

export {
  ST_IN_FLIGHT,
  envelopeAtRest,
  heardStage,
  voiceDormant,
  voiceFilterQuiet,
  voiceFinished,
  voiceHoldsEndLevel,
};
