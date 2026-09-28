/* eslint-disable no-magic-numbers -- DSP: MIDI 69/440, cents and octave scales are the pitch and level arithmetic; the tunables are fmConstants.ts (#654) */
/**
 * The voice's control-rate work (#645): `bindVoiceConstants`, the routing
 * flags and per-note `Math.pow` results computed once per note (#548), and
 * `updateVoiceControl`, which advances every envelope and both LFOs by
 * CTRL_INTERVAL samples, glides the pitch, refreshes the filter
 * coefficients and sets the per-sample amplitude and width ramps the render
 * loops only add. Functions over the voice, called once per control block by
 * `Voice.bindConstants` and `Voice.updateControl`. Invariant: allocation
 * free; `specialise` selects the precomputed constants or the inline
 * `Math.pow`, and both paths must yield the same bits
 * (`fmProcessorKernel.test.ts`). LFO 2's terms are appended to LFO 1's, so
 * an inert LFO 2 adds exactly ±0 and a width of 1 ramps nowhere: the golden
 * test pins the whole update.
 */

import type { WorkletPatch } from './patchNormalise';
import type { Voice } from './voice';
import { ALGORITHMS, ALG_CARRIER_BITS, ALG_DESCENDING, ALG_EDGES } from './algorithms';
import { WIDTH_SNAP } from './fmConstants';
import { FILT_OFF } from './modeIds';
import { WIDTH_RANGE } from './patchDefaults';
import { KIND_NOISE, KIND_PULSE, KIND_TABLE, mipIndex } from './waveTables';

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
 * The value the render loops read for a width (#55): the duty itself for a
 * PULSE operator, and for every other wave the phase scale `1 / width`, so
 * the squeeze in the loops is a multiply, not a divide. Width 1 reads 1
 * either way. `start` and `rebind` seed the ramp with it.
 */
function restingWidth(kind: number, width: number): number {
  return kind === KIND_PULSE ? width : 1 / width;
}

/**
 * Operator `i`'s width for this block (#55): its effective width, both LFOs
 * added and clamped to WIDTH_RANGE, sets a per-sample ramp to the value the
 * loops read (`restingWidth`), and the mip table: a squeezed wave's segment
 * plays at `freq / width`, so the table is picked for the narrower of the
 * ramp's two ends, and a PULSE reads its saw tables at `freq`. A ramp
 * that has all but arrived lands on its target (WIDTH_SNAP), so a width back
 * at 1 takes the plain wave's path again. Width 1 with no LFO depth reads
 * `freq * 1` and ramps by 0: the old block exactly. Allocates nothing.
 */
// eslint-disable-next-line max-params -- one operator's control-rate inputs, called four times per block; an options object would allocate on the audio thread
function updateOperatorWidth(
  voice: Voice,
  i: number,
  freq: number,
  lfoVal: number,
  lfo2Val: number,
  n: number,
): void {
  const patch = voice.patch!;
  const raw = patch.ops[i].width + lfoVal * patch.lfo.toWidth[i] + lfo2Val * patch.lfo2.toWidth[i];
  const width =
    raw < WIDTH_RANGE.min ? WIDTH_RANGE.min : raw > WIDTH_RANGE.max ? WIDTH_RANGE.max : raw;
  const kind = voice.kind[i];
  if (kind === KIND_TABLE && voice.mips[i]) {
    // The narrower of the ramp's two ends, so the table is safe for the whole
    // block either way: `voice.width` holds 1 / width now, so the larger
    // phase scale is freq / min(width now, width target).
    const scale = Math.max(voice.width[i], 1 / width);
    voice.tables[i] = voice.mips[i]![mipIndex(freq * scale)];
  } else if (kind === KIND_PULSE && voice.mips[i]) {
    voice.tables[i] = voice.mips[i]![mipIndex(freq)];
  }
  const target = restingWidth(kind, width);
  const step = target - voice.width[i];
  if (step < WIDTH_SNAP && step > -WIDTH_SNAP) {
    voice.width[i] = target;
    voice.widthInc[i] = 0;
  } else {
    voice.widthInc[i] = step / n;
  }
}

/**
 * Control-rate update: advance every envelope and both LFOs by CTRL_INTERVAL
 * samples, then set up per-sample amplitude and width ramps so the audio loop
 * only does adds. Also refreshes filter coefficients. LFO 2 (#55) reaches
 * pitch, level, width and the filter through its own settings, with LFO 1's
 * wheel arithmetic.
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
  const lfo2P = patch.lfo2;
  // The part's wheel plus this note's accent (#602); adding 0 is exact.
  const modWheel = wheel + voice.mod;
  const lfoVal =
    voice.lfo.advance(lfoP, n, voice.sr) * (lfoP.amount + modWheel * lfoP.modWheelDepth);
  const lfo2Val =
    voice.lfo2.advance(lfo2P, n, voice.sr) * (lfo2P.amount + modWheel * lfo2P.modWheelDepth);

  // Glide toward the target note: a slide's own time first, else the patch's.
  const glide = voice.glideSeconds > 0 ? voice.glideSeconds : patch.glide;
  if (glide > 0) {
    const coef = 1 - Math.exp(-n / (glide * voice.sr));
    voice.pitchCur += (voice.pitchTarget - voice.pitchCur) * coef;
  } else {
    voice.pitchCur = voice.pitchTarget;
  }

  const pEnv = voice.pitchEnv.advance(n) * patch.pitchEnvAmount;
  const semis =
    voice.pitchCur + voice.detune + bend + pEnv + lfoVal * lfoP.toPitch + lfo2Val * lfo2P.toPitch;
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
    updateOperatorWidth(voice, i, freq, lfoVal, lfo2Val, n);

    const env = voice.ampEnv[i].advance(n);
    const velAmp = 1 - op.velSens + op.velSens * velCurve;
    const keyAmp = specialise ? voice.levelKeyAmp[i] : Math.pow(2, -op.levelKeyScale * keyOffset);
    const lfoAmp = 1 + lfoVal * lfoP.toOp[i] + lfo2Val * lfo2P.toOp[i];
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
      cutoffMod +
      lfo2Val * f.lfo2Amount;
    const cutoff = f.cutoff * Math.pow(2, octaves);
    voice.svfA.setCoeffs(cutoff, f.resonance, voice.sr);
    if (f.slope24) voice.svfB.setCoeffs(cutoff, f.resonance, voice.sr);
  }

  voice.age += n;
}

export { bindVoiceConstants, restingWidth, updateVoiceControl };
