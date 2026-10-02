/**
 * Voice allocation and stealing for one part: which voice of the pool a new
 * note takes. The pool is the sounding limit plus a reserve at least as
 * large (`stealPoolSize`, windsor#410), so a stolen voice can fade out while
 * its replacement already sounds; the part builds it once (`fmProcessor.ts`)
 * and this only picks from it.
 *
 * Invariant: the pool never holds more sounding voices than the limit, a
 * dormant voice counting as sounding, and a stolen voice that is not dormant
 * fades (30 ms, `stealVoice` in `voiceSteal.ts`) rather than being cut. A
 * function over the pool, called once a voice a note-on (moved out of the
 * processor's class in windsor#270); allocation free.
 * `fmProcessorStealFade.test.ts` pins the stealing order and the fade,
 * `fmProcessor.test.ts` the limit, and `fmProcessorDormancy.test.ts` the
 * dormant steal.
 */

import type { Voice } from './voice';
import { nearestFadeEnd, quietestReleased, stealVoice } from './voiceSteal';

/**
 * Pick a voice from `voices` for a new note.
 *
 * If the part is already at its sounding limit (`maxVoices`), the least
 * valuable voice is asked to fade out (30 ms) rather than being cut dead, and
 * the new note takes a reserve slot. Only an exhausted pool falls back to a
 * hard cut, of the fading voice nearest the end of its fade.
 *
 * Priority for stealing (windsor#410): dormant (#547, only with `dormancy`
 * on), oldest first, killed outright since it is silent and needs no fade;
 * then the quietest released voice; otherwise the oldest held one. A dormant
 * voice counts as sounding, so the pool never holds more than the limit.
 */
function allocateVoice(voices: Voice[], maxVoices: number, dormancy: boolean): Voice {
  const vs = voices;
  let free: Voice | null = null;
  let sounding = 0;
  let bestDormant: Voice | null = null,
    bestDormantAge = -1;
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
    const victim = quietestReleased(vs) || bestAny;
    if (victim) stealVoice(victim);
  }

  if (free) return free;

  // Pool exhausted (more fades at once than the reserve holds): cut the fade nearest its end.
  const last = nearestFadeEnd(vs);
  last.kill();
  return last;
}

export { allocateVoice };
