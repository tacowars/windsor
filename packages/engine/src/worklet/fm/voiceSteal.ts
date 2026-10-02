/**
 * How a full part steals a voice (windsor#410): the pool, its size and the
 * reserve slots' seeds, the fade a stolen voice plays out, the released
 * voice to take, and the fading voice an exhausted pool cuts. `allocateVoice` (`voiceAllocation.ts`) decides when
 * to steal; this owns what a steal does. A stolen voice fades over
 * `STEAL_FADE_SECONDS` from the level it plays at, and the released voice
 * taken is the quietest, read from its carriers' amplitude ramps, the level
 * the voice outputs now. The 4 ms `Voice.steal` stays the mono cut and the
 * fade of a held End level (windsor#7).
 *
 * Invariant: functions over the voices, run once a note-on at most (the
 * pool once, at construction); allocation free, and no double crosses a
 * call (each level is read and compared in place). `fmProcessorStealFade.test.ts` pins the fade, the order
 * and the reserve; the decision is
 * `docs/log/2026-10-02-voice-steals-fade-the-quietest-tail.md`.
 */

import { STEAL_FADE_SECONDS, STEAL_RESERVE_MIN, STEAL_STREAMED_RESERVE } from './fmConstants';
import { makeRandom } from './prng';
import { Voice } from './voice';

/** What the pool's voices share with their part: its random stream, its controls and its lanes. */
interface PoolOwner {
  readonly random: () => number;
  readonly partControls: Float64Array;
  readonly partOffsets: Float64Array;
  readonly partFloors: Float64Array;
}

/**
 * The pool for a sounding limit of `maxVoices`: the limit plus a reserve of
 * at least the limit and at least `STEAL_RESERVE_MIN`, so every voice a chord
 * steals can fade out while the voice that replaced it sounds. Built once, at
 * construction.
 */
function stealPoolSize(maxVoices: number): number {
  return maxVoices + Math.max(maxVoices, STEAL_RESERVE_MIN);
}

/**
 * How many of the pool's voices seed from the part's random stream: the
 * limit and the four reserve slots the pool had before windsor#410. Each
 * voice draws two seeds as it is built, so a slot past these drawing too
 * would move every note's free phase and pan jitter in a seeded render.
 */
function streamedPoolSize(maxVoices: number): number {
  return maxVoices + STEAL_STREAMED_RESERVE;
}

/**
 * The stream the slots past `streamedPoolSize` seed from, seeded by the last
 * streamed voice's noise seed: reproducible under a part's seed, and never a
 * draw from the part's stream. Built once, at construction.
 */
function reserveRandom(lastStreamed: Voice): () => number {
  return makeRandom(lastStreamed.noiseSeed);
}

/**
 * The part's pool, built once at construction: `stealPoolSize` voices, every
 * one playing from the part's random stream. The first `streamedPoolSize`
 * draw their seeds from it as the pool always did, the rest from
 * `reserveRandom`, so the part's stream is drawn as before the pool grew.
 */
function buildVoicePool(part: PoolOwner, maxVoices: number, sampleRate: number): Voice[] {
  const poolSize = stealPoolSize(maxVoices);
  const streamed = streamedPoolSize(maxVoices);
  const voices: Voice[] = new Array(poolSize);
  let seeds = part.random;
  for (let i = 0; i < poolSize; i++) {
    if (i === streamed) seeds = reserveRandom(voices[i - 1]);
    const { partControls, partOffsets, partFloors } = part;
    voices[i] = new Voice(sampleRate, seeds, partControls, partOffsets, partFloors);
    voices[i].random = part.random;
  }
  return voices;
}

/** Fade `voice` out over `STEAL_FADE_SECONDS` from where it plays; the render frees it at 0. */
function stealVoice(voice: Voice): void {
  if (!voice.active) return;
  voice.gate = false;
  voice.fadeInc = -1 / (STEAL_FADE_SECONDS * voice.sr);
}

/**
 * The quietest released voice still sounding and not yet fading, or null: its
 * carriers' amplitudes summed (`voice.amp`, the ramp the render plays now,
 * velocity and envelope included), the older of two equal ones.
 */
function quietestReleased(voices: Voice[]): Voice | null {
  let best: Voice | null = null;
  let bestLevel = Infinity;
  let bestAge = -1;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    if (!v.active || v.gate || v.fading) continue;
    const carriers = v.alg.carriers;
    let level = 0;
    for (let c = 0; c < carriers.length; c++) level += Math.abs(v.amp[carriers[c]]);
    if (level < bestLevel || (level === bestLevel && v.age > bestAge)) {
      best = v;
      bestLevel = level;
      bestAge = v.age;
    }
  }
  return best;
}

/**
 * An exhausted pool's last resort: the fading voice with the fewest samples
 * of its fade left, which the caller cuts. With no voice fading, the oldest.
 */
function nearestFadeEnd(voices: Voice[]): Voice {
  let best = voices[0];
  let bestLeft = Infinity;
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i];
    if (!v.fading) continue;
    const left = v.fade / -v.fadeInc;
    if (left < bestLeft) {
      best = v;
      bestLeft = left;
    }
  }
  if (bestLeft !== Infinity) return best;
  for (let i = 1; i < voices.length; i++) if (voices[i].age > best.age) best = voices[i];
  return best;
}

export {
  buildVoicePool,
  nearestFadeEnd,
  quietestReleased,
  reserveRandom,
  stealPoolSize,
  stealVoice,
  streamedPoolSize,
};
