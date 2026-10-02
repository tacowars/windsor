/* eslint-disable no-magic-numbers -- DSP: MIDI 69/440, cents and octave scales are the pitch and level arithmetic; the tunables are fmConstants.ts (#654) */
/**
 * The voice's control-rate work (#645): `bindVoiceConstants`, the routing
 * flags and per-note `Math.pow` results computed once per note (#548) and
 * each Noise operator's colour (windsor#362), and
 * `updateVoiceControl`, which advances every envelope and both LFOs by
 * CTRL_INTERVAL samples, glides the pitch, refreshes the drive stage
 * (windsor#300) and the filter coefficients and sets the per-sample amplitude
 * ramps (`voiceAmpRamp.ts`, with each envelope segment end at its own sample:
 * windsor#301) and width ramps the render loops only add. Functions over the
 * voice, called once per control block by `Voice.bindConstants` and
 * `Voice.updateControl`. Invariant: allocation
 * free; `specialise` selects the precomputed constants or the inline
 * `Math.pow`, and both paths must yield the same bits
 * (`fmProcessorKernel.test.ts`). LFO 2's terms are appended to LFO 1's, so
 * an inert LFO 2 adds exactly ±0 and a width of 1 ramps nowhere: the golden
 * test pins the whole update. No double crosses a call here as an argument
 * or a return (windsor#233): the part's bend and wheel arrive in
 * `voice.partControls`, the envelopes and LFOs leave their results in their
 * fields, and an operator's width reads its frequency and the LFO levels
 * from the voice, since V8 does not inline every call this update makes and
 * a double crossing one it does not inline is a new heap number on the audio
 * thread (`synth/fmProcessorAllocation.test.ts`). A song's lanes and a
 * note's steps move the values a ringing voice plays (windsor#346,
 * windsor#419): the update starts by laying them out in `liveValues` by
 * target code (`voiceOffsets.ts`), and every read below of a value a lane or
 * a step can move reads it there.
 */

import type { WorkletPatch } from './patchNormalise';
import type { Voice } from './voice';
import { ALGORITHMS, ALG_CARRIER_BITS, ALG_EDGES } from './algorithms';
import { WIDTH_SNAP } from './fmConstants';
import { FILT_FORMANT, FILT_OFF } from './modeIds';
import { bindNoiseColour } from './noiseColour';
import { WIDTH_RANGE } from './patchDefaults';
import { updateOperatorAmp } from './voiceAmpRamp';
import { updateVoiceDrive } from './voiceDrive';
import { FORMANT_SHIFT_SLOT, updateVoiceFormant } from './voiceFormant';
import { applyVoiceOffsets } from './voiceOffsets';
import {
  VT_CUTOFF,
  VT_ENV_AMOUNT,
  VT_LFO2_AMOUNT,
  VT_LFO_AMOUNT,
  VT_OP_BASE,
  VT_OP_STRIDE,
  VT_OP_WIDTH,
  VT_PITCH_ENV_AMOUNT,
  VT_RESONANCE,
} from './voiceTargetTables';
import { KIND_PULSE, KIND_TABLE, mipIndexAt } from './waveTables';

/** The frequency a squeezed wave's table is chosen for, passed to `mipIndexAt` in place of an argument. */
const MIP_FREQ_SLOT = new Float64Array(1);

/** `Voice.partControls`, the part's k-rate parameters for this quantum: one slot each. */
const PART_BEND = 0,
  PART_WHEEL = 1,
  PART_CONTROL_COUNT = 2;

/**
 * Routing and per-note constants for the bound patch, after `kind` and
 * `order` are set:
 * called by `start` and `rebind`, so a live retune of the algorithm, a wave
 * or a detune reaches the next control block. Each Noise operator's colour
 * is tuned here too (windsor#362): the fields change only with the bound
 * patch, so binding them is the per-block update at no per-block cost.
 * Allocates nothing.
 */
function bindVoiceConstants(voice: Voice, patch: WorkletPatch): void {
  const algIndex = ALGORITHMS[patch.algorithm] ? patch.algorithm : 0;
  const keyOffset = (voice.note - 60) / 12;
  for (let i = 0; i < 4; i++) {
    const op = patch.ops[i];
    voice.detuneMul[i] = Math.pow(2, op.detune / 1200);
    voice.levelKeyAmp[i] = Math.pow(2, -op.levelKeyScale * keyOffset);
    bindNoiseColour(voice, i);
  }
  voice.edges = ALG_EDGES[algIndex];
  voice.carrierBits = ALG_CARRIER_BITS[algIndex];
  // Any number of Noise operators takes the kernel (windsor#389): both
  // loops draw a sample's noise D..A, so only the algorithm's edges decide.
  voice.kernel = voice.specialise && voice.edges >= 0;
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
 * Operator `i`'s width for this block (#55): its live width (the
 * patch's, a step's or a lane's), both LFOs
 * added and clamped to WIDTH_RANGE, sets a per-sample ramp to the value the
 * loops read (`restingWidth`), and the mip table: a squeezed wave's segment
 * plays at `freq / width`, so the table is picked for the narrower of the
 * ramp's two ends, and a PULSE reads its saw tables at `freq`. A ramp
 * that has all but arrived lands on its target (WIDTH_SNAP), so a width back
 * at 1 takes the plain wave's path again. Width 1 with no LFO depth reads
 * `freq * 1` and ramps by 0: the old block exactly. The operator's frequency
 * and the two LFO levels are the voice's `opFreq[i]`, `lfoLevel` and
 * `lfo2Level`, this block's, so no double is passed in. Allocates nothing.
 */
function updateOperatorWidth(voice: Voice, i: number, n: number): void {
  const patch = voice.patch!;
  const freq = voice.opFreq[i];
  const lfoVal = voice.lfoLevel;
  const lfo2Val = voice.lfo2Level;
  const own = voice.liveValues[VT_OP_BASE + i * VT_OP_STRIDE + VT_OP_WIDTH];
  const raw = own + lfoVal * patch.lfo.toWidth[i] + lfo2Val * patch.lfo2.toWidth[i];
  const width =
    raw < WIDTH_RANGE.min ? WIDTH_RANGE.min : raw > WIDTH_RANGE.max ? WIDTH_RANGE.max : raw;
  const kind = voice.kind[i];
  if (kind === KIND_TABLE && voice.mips[i]) {
    // The narrower of the ramp's two ends, so the table is safe for the whole
    // block either way: `voice.width` holds 1 / width now, so the larger
    // phase scale is freq / min(width now, width target).
    const scale = Math.max(voice.width[i], 1 / width);
    MIP_FREQ_SLOT[0] = freq * scale;
    voice.tables[i] = voice.mips[i]![mipIndexAt(MIP_FREQ_SLOT, 0)];
  } else if (kind === KIND_PULSE && voice.mips[i]) {
    voice.tables[i] = voice.mips[i]![mipIndexAt(voice.opFreq, i)];
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
 * The filter's part of the control update, after the operators': its
 * envelope, and each stage's coefficients for the voice's cutoff moved by
 * the envelope, the wheel, both LFOs and key tracking; a song lane or a step
 * on the cutoff moves the cutoff itself, as the knob does; in the Formant mode the same octaves shift its three peaks
 * instead (`voiceFormant.ts`, windsor#331). The LFO levels are the voice's `lfoLevel` and `lfo2Level`, this
 * block's, and the wheel and key offset are worked out again as the update
 * works them, so no double is passed in (windsor#233). Allocates nothing.
 */
function updateVoiceFilter(voice: Voice, n: number): void {
  const f = voice.patch!.filter;
  if (f.mode === FILT_OFF) return;
  const controls = voice.partControls;
  const modWheel = controls[PART_WHEEL] + voice.mod;
  const keyOffset = (voice.note - 60) / 12;
  voice.filtEnv.advance(n);
  const fenv = voice.filtEnv.value;
  // The wheel adds to the envelope amount the way it adds to the LFO's
  // (#586): depth 0 leaves the term exactly as it was. The amount, cutoff
  // and resonance are the voice's live values: the patch's, a step's
  // (windsor#17) and a song lane's (windsor#346), all one layout (windsor#419).
  const live = voice.liveValues;
  const resonance = live[VT_RESONANCE];
  const octaves =
    fenv * (live[VT_ENV_AMOUNT] + modWheel * f.modWheelDepth) +
    voice.lfoLevel * f.lfoAmount +
    f.keyTrack * keyOffset +
    voice.lfo2Level * f.lfo2Amount;
  // Formant (windsor#331): the same octaves move its three peaks, not `cutoff`.
  if (f.mode === FILT_FORMANT) {
    FORMANT_SHIFT_SLOT[0] = Math.pow(2, octaves);
    updateVoiceFormant(voice);
    return;
  }
  const cutoff = live[VT_CUTOFF] * Math.pow(2, octaves);
  const svfA = voice.svfA;
  svfA.cutoffHz = cutoff;
  svfA.q = resonance;
  svfA.setCoeffs(voice.sr);
  if (f.slope24) {
    const svfB = voice.svfB;
    svfB.cutoffHz = cutoff;
    svfB.q = resonance;
    svfB.setCoeffs(voice.sr);
  }
}

/**
 * Control-rate update: advance every envelope and both LFOs by CTRL_INTERVAL
 * samples, then set up per-sample amplitude ramps (`updateOperatorAmp`,
 * through each operator envelope's segment ends: windsor#301) and width ramps
 * so the audio loop only does adds. Also refreshes filter coefficients. LFO 2
 * (#55) reaches pitch, level, width and the filter through its own settings,
 * with LFO 1's wheel arithmetic.
 */
function updateVoiceControl(voice: Voice, n: number): void {
  const patch = voice.patch!;
  const lfoP = patch.lfo;
  const lfo2P = patch.lfo2;
  const controls = voice.partControls;
  const bend = controls[PART_BEND];
  // The values this block plays, with the song's lanes on them (windsor#346):
  // without an offset, each is the voice's own exactly.
  applyVoiceOffsets(voice);
  const live = voice.liveValues;
  // The part's wheel plus this note's accent (#602); adding 0 is exact.
  const modWheel = controls[PART_WHEEL] + voice.mod;
  voice.lfo.advance(lfoP, n, voice.sr);
  const lfoVal = voice.lfo.output * (live[VT_LFO_AMOUNT] + modWheel * lfoP.modWheelDepth);
  voice.lfo2.advance(lfo2P, n, voice.sr);
  const lfo2Val = voice.lfo2.output * (live[VT_LFO2_AMOUNT] + modWheel * lfo2P.modWheelDepth);
  voice.lfoLevel = lfoVal;
  voice.lfo2Level = lfo2Val;

  // Glide toward the target note: a slide's own time first, else the patch's.
  const glide = voice.glideSeconds > 0 ? voice.glideSeconds : patch.glide;
  if (glide > 0) {
    const coef = 1 - Math.exp(-n / (glide * voice.sr));
    voice.pitchCur += (voice.pitchTarget - voice.pitchCur) * coef;
  } else {
    voice.pitchCur = voice.pitchTarget;
  }

  voice.pitchEnv.advance(n);
  const pEnv = voice.pitchEnv.value * live[VT_PITCH_ENV_AMOUNT];
  const semis =
    voice.pitchCur + voice.detune + bend + pEnv + lfoVal * lfoP.toPitch + lfo2Val * lfo2P.toPitch;
  const baseFreq = 440 * Math.pow(2, (semis - 69) / 12);

  const specialise = voice.specialise;
  for (let i = 0; i < 4; i++) {
    const op = patch.ops[i];

    // The same Math.pow results, computed once per note (#548).
    const detuneMul = specialise ? voice.detuneMul[i] : Math.pow(2, op.detune / 1200);
    const freq = op.fixed ? op.fixedHz * detuneMul : baseFreq * op.ratio * detuneMul;
    voice.phaseInc[i] = freq / voice.sr;
    voice.opFreq[i] = freq;
    updateOperatorWidth(voice, i, n);
    updateOperatorAmp(voice, i, n);
  }

  updateVoiceDrive(voice);
  updateVoiceFilter(voice, n);

  voice.age += n;
}

export {
  PART_BEND,
  PART_WHEEL,
  PART_CONTROL_COUNT,
  bindVoiceConstants,
  restingWidth,
  updateVoiceControl,
};
