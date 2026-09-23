/**
 * The voice's control-rate work (#645): `bindVoiceConstants`, the routing
 * flags and per-note `Math.pow` results computed once per note (#548), and
 * `updateVoiceControl`, which advances every envelope and the LFO by
 * CTRL_INTERVAL samples, glides the pitch, refreshes the filter
 * coefficients and sets the per-sample amplitude ramps the render loops
 * only add. Functions over the voice, called once per control block by
 * `Voice.bindConstants` and `Voice.updateControl`. Invariant: allocation
 * free; `specialise` selects the precomputed constants or the inline
 * `Math.pow`, and both paths must yield the same bits
 * (`fmProcessorKernel.test.ts`). The golden test pins the whole update.
 */

import type { WorkletPatch } from './patchNormalise';
import type { Voice } from './voice';
import { ALGORITHMS, ALG_CARRIER_BITS, ALG_DESCENDING, ALG_EDGES } from './algorithms';
import { FILT_OFF } from './svf';
import { KIND_NOISE, KIND_TABLE, mipIndex } from './waveTables';

/**
 * Routing and per-note constants for the bound patch, after `kind` is set:
 * called by `start` and `rebind`, so a live retune of the algorithm, a wave
 * or a detune reaches the next control block. Allocates nothing.
 */
function bindVoiceConstants(voice: Voice, patch: WorkletPatch): void {
  const algIndex = ALGORITHMS[patch.algorithm] ? patch.algorithm : 0;
  const keyOffset = (voice.note - 60) / 12;
  let noiseOps = 0;
  for (let i = 0; i < 4; i++) {
    const op = patch.ops[i];
    voice.detuneMul[i] = Math.pow(2, op.detune / 1200);
    voice.levelKeyAmp[i] = Math.pow(2, -op.levelKeyScale * keyOffset);
    if (voice.kind[i] === KIND_NOISE) noiseOps++;
  }
  voice.edges = ALG_EDGES[algIndex];
  voice.carrierBits = ALG_CARRIER_BITS[algIndex];
  voice.kernel = voice.specialise && voice.edges >= 0 && (noiseOps < 2 || ALG_DESCENDING[algIndex]);
}

/**
 * Control-rate update: advance every envelope and the LFO by CTRL_INTERVAL
 * samples, then set up per-sample amplitude ramps so the audio loop only
 * does adds. Also refreshes filter coefficients.
 */
function updateVoiceControl(
  voice: Voice,
  n: number,
  bend: number,
  wheel: number,
  cutoffMod: number,
): void {
  const patch = voice.patch!;
  const lfoP = patch.lfo;
  // The part's wheel plus this note's accent (#602); adding 0 is exact.
  const modWheel = wheel + voice.mod;
  const lfoVal =
    voice.lfo.advance(lfoP, n, voice.sr) * (lfoP.amount + modWheel * lfoP.modWheelDepth);

  // Glide toward the target note: a slide's own time first, else the patch's.
  const glide = voice.glideSeconds > 0 ? voice.glideSeconds : patch.glide;
  if (glide > 0) {
    const coef = 1 - Math.exp(-n / (glide * voice.sr));
    voice.pitchCur += (voice.pitchTarget - voice.pitchCur) * coef;
  } else {
    voice.pitchCur = voice.pitchTarget;
  }

  const pEnv = voice.pitchEnv.advance(n) * patch.pitchEnvAmount;
  const semis = voice.pitchCur + voice.detune + bend + pEnv + lfoVal * lfoP.toPitch;
  const baseFreq = 440 * Math.pow(2, (semis - 69) / 12);

  const velCurve = voice.velocity;
  const keyOffset = (voice.note - 60) / 12;

  const specialise = voice.specialise;
  for (let i = 0; i < 4; i++) {
    const op = patch.ops[i];

    // The same Math.pow results, computed once per note (#548).
    const detuneMul = specialise ? voice.detuneMul[i] : Math.pow(2, op.detune / 1200);
    const freq = op.fixed ? op.fixedHz * detuneMul : baseFreq * op.ratio * detuneMul;
    voice.phaseInc[i] = freq / voice.sr;

    if (voice.kind[i] === KIND_TABLE && voice.mips[i]) {
      voice.tables[i] = voice.mips[i]![mipIndex(freq)];
    }

    const env = voice.ampEnv[i].advance(n);
    const velAmp = 1 - op.velSens + op.velSens * velCurve;
    const keyAmp = specialise ? voice.levelKeyAmp[i] : Math.pow(2, -op.levelKeyScale * keyOffset);
    const lfoAmp = 1 + lfoVal * lfoP.toOp[i];
    const target = env * op.level * op.level * velAmp * keyAmp * (lfoAmp < 0 ? 0 : lfoAmp);

    voice.ampInc[i] = (target - voice.amp[i]) / n;
  }

  // Filter
  const f = patch.filter;
  if (f.mode !== FILT_OFF) {
    const fenv = voice.filtEnv.advance(n);
    // The wheel adds to the envelope amount the way it adds to the LFO's
    // (#586): depth 0 leaves the term exactly as it was.
    const octaves =
      fenv * (f.envAmount + modWheel * f.modWheelDepth) +
      lfoVal * f.lfoAmount +
      f.keyTrack * keyOffset +
      cutoffMod;
    const cutoff = f.cutoff * Math.pow(2, octaves);
    voice.svfA.setCoeffs(cutoff, f.resonance, voice.sr);
    if (f.slope24) voice.svfB.setCoeffs(cutoff, f.resonance, voice.sr);
  }

  voice.age += n;
}

export { bindVoiceConstants, updateVoiceControl };
