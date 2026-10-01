/**
 * Voice allocation and stealing for one part: which voice of the pool a new
 * note takes. The pool is the sounding limit plus four reserve slots, so a
 * stolen voice can fade out while its replacement already sounds; the part
 * builds it once (`fmProcessor.ts`) and this only picks from it.
 *
 * Invariant: the pool never holds more sounding voices than the limit, a
 * dormant voice counting as sounding, and a stolen voice that is not dormant
 * fades (4 ms, `Voice.steal`) rather than being cut. A function over the
 * pool, called once a voice a note-on (moved out of the processor's class in
 * windsor#270, unchanged); allocation free. `fmProcessor.test.ts` pins the
 * stealing order and `fmProcessorDormancy.test.ts` the dormant steal.
 */

import type { Voice } from './voice';

/**
 * Pick a voice from `voices` for a new note.
 *
 * If the part is already at its sounding limit (`maxVoices`), the least
 * valuable voice is asked to fade out (4 ms) rather than being cut dead, and
 * the new note takes a reserve slot. Only an exhausted pool falls back to a
 * hard kill.
 *
 * Priority for stealing: dormant (#547, only with `dormancy` on), oldest
 * first, killed outright since it is silent and needs no fade; then already
 * released, oldest first; otherwise oldest. A dormant voice counts as
 * sounding, so the pool never holds more than the limit.
 */
function allocateVoice(voices: Voice[], maxVoices: number, dormancy: boolean): Voice {
  const vs = voices;
  let free: Voice | null = null;
  let sounding = 0;
  let bestDormant: Voice | null = null,
    bestDormantAge = -1;
  let bestReleased: Voice | null = null,
    bestReleasedAge = -1;
  let bestAny: Voice | null = null,
    bestAnyAge = -1;

  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (v.active && v.finished && !v.fading) v.active = false;

    if (!v.active) {
      if (!free) free = v;
      continue;
    }
    if (v.fading) continue; // sounding but already on its way out

    sounding++;
    if (dormancy && v.age > bestDormantAge && v.dormant) {
      bestDormantAge = v.age;
      bestDormant = v;
    }
    if (!v.gate && v.age > bestReleasedAge) {
      bestReleasedAge = v.age;
      bestReleased = v;
    }
    if (v.age > bestAnyAge) {
      bestAnyAge = v.age;
      bestAny = v;
    }
  }

  if (sounding >= maxVoices) {
    if (bestDormant) {
      bestDormant.kill();
      return bestDormant;
    }
    const victim = bestReleased || bestAny;
    if (victim) victim.steal();
  }

  if (free) return free;

  // Pool exhausted (many simultaneous fades). Take the oldest outright.
  let oldest = vs[0];
  for (let i = 1; i < vs.length; i++) if (vs[i].age > oldest.age) oldest = vs[i];
  oldest.kill();
  return oldest;
}

export { allocateVoice };
