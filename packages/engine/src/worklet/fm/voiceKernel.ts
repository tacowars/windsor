/* eslint-disable no-magic-numbers -- DSP: the kernel's feedback average, interpolation and mip arithmetic, bit for bit the generic loop's; the tunables are fmConstants.ts (#654) */
/* eslint-disable max-lines -- one hot loop written out per operator (#548); #55's width and PULSE reads took it past 350, and slicing it would reload the locals it exists to keep */
/**
 * The fixed-index voice kernel (#548, #645): `renderVoiceGeneric`'s
 * arithmetic in its order, with the four operators written out, their state
 * in locals for the call, routing read as edge and carrier flags, and an
 * operator whose amplitude is exactly 0 for the whole call skipped. Invariant:
 * bit-identical with the generic loop by construction — the same IEEE
 * operations in the same order. What breaks it: a reordered sum, a
 * `Math.fround` lost to a helper's return (a Float32Array store rounds; a
 * local does not, so every store-back is explicit), a local hoisted onto the
 * voice, a term dropped that is not exactly ±0. Width (#55) follows the
 * generic loop's reads: a flag per operator, hoisted, keeps width 1 on the old
 * read, and the width ramp runs beside the phase, live or not, as the generic
 * loop's does. This function is not sliced
 * finer, whatever `max-lines-per-function` says: a helper per operator would
 * reload the state through the voice and give the saving back
 * (docs/research/2026-09-15-548-fm-voice-loop-specialisation).
 * `fmProcessorKernel.test.ts` compares it with the generic loop on every
 * preset; the golden test pins it.
 */

import type { Voice } from './voice';
import { A, B, C, D, EDGE_BA, EDGE_CA, EDGE_CB, EDGE_DA, EDGE_DB, EDGE_DC } from './algorithms';
import {
  FEEDBACK_SAW_CYCLES,
  FEEDBACK_SQUARE_CYCLES,
  MOD_INDEX_SCALE,
  TABLE_SIZE,
} from './fmConstants';
import { FILT_OFF } from './modeIds';
import { softClip } from './svf';
import { KIND_NOISE, KIND_PULSE, KIND_SAW_D, KIND_TABLE } from './waveTables';

/**
 * `render`, with fixed operator indices (#548): see `ALG_EDGES` for why the
 * output is the same bits. Per-operator state lives in locals for the call
 * and is written back at the end; a Float32Array store is a `Math.fround`.
 *
 * An operator whose amplitude is exactly 0 and not ramping for the whole
 * call contributes ±0 to every sum it is in, so its wave is not computed.
 * Its phase still runs, and its feedback history becomes the ±0 the generic
 * loop would have stored. A noise operator is never skipped: its draws
 * advance the voice's shared noise generator.
 */
// Four operators written out, then the carrier sum and the filter, over locals
// hoisted out of the loop. The fixed indices and the locals are the saving
// (docs/research/2026-09-15-548-fm-voice-loop-specialisation); a helper per
// operator would reload the state through `this` and give it back.
// eslint-disable-next-line max-lines-per-function -- one hot loop, see above
function renderVoiceKernel(
  voice: Voice,
  outL: Float32Array,
  outR: Float32Array,
  off: number,
  n: number,
): void {
  const patch = voice.patch!;
  const nCar = voice.alg.carriers.length;
  const carGain = 1 / Math.sqrt(nCar);
  const f = patch.filter;
  const mode = f.mode;
  const drive = f.drive;
  const slope24 = f.slope24;
  const gain = patch.volume * carGain;
  const panL = voice.panL,
    panR = voice.panR;

  let fade = voice.fade;
  const fadeInc = voice.fadeInc;

  const phase = voice.phase,
    phaseInc = voice.phaseInc,
    out = voice.out;
  const fb1 = voice.fb1,
    fb2 = voice.fb2,
    amp = voice.amp,
    ampInc = voice.ampInc;
  const kind = voice.kind,
    tables = voice.tables;
  const fbAmt = voice.opFeedback;
  const edges = voice.edges,
    carriers = voice.carrierBits;

  const kA = kind[A],
    kB = kind[B],
    kC = kind[C],
    kD = kind[D];
  const liveA = kA === KIND_NOISE || amp[A] !== 0 || ampInc[A] !== 0;
  const liveB = kB === KIND_NOISE || amp[B] !== 0 || ampInc[B] !== 0;
  const liveC = kC === KIND_NOISE || amp[C] !== 0 || ampInc[C] !== 0;
  const liveD = kD === KIND_NOISE || amp[D] !== 0 || ampInc[D] !== 0;
  const modBA = liveA && liveB && (edges & EDGE_BA) !== 0;
  const modCA = liveA && liveC && (edges & EDGE_CA) !== 0;
  const modDA = liveA && liveD && (edges & EDGE_DA) !== 0;
  const modCB = liveB && liveC && (edges & EDGE_CB) !== 0;
  const modDB = liveB && liveD && (edges & EDGE_DB) !== 0;
  const modDC = liveC && liveD && (edges & EDGE_DC) !== 0;
  const carA = (carriers & 1) !== 0,
    carB = (carriers & 2) !== 0,
    carC = (carriers & 4) !== 0,
    carD = (carriers & 8) !== 0;

  const tA = tables[A]!,
    tB = tables[B]!,
    tC = tables[C]!,
    tD = tables[D]!;
  const fbA = fbAmt[A],
    fbB = fbAmt[B],
    fbC = fbAmt[C],
    fbD = fbAmt[D];
  const incA = phaseInc[A],
    incB = phaseInc[B],
    incC = phaseInc[C],
    incD = phaseInc[D];
  const aiA = ampInc[A],
    aiB = ampInc[B],
    aiC = ampInc[C],
    aiD = ampInc[D];
  let phA = phase[A],
    phB = phase[B],
    phC = phase[C],
    phD = phase[D];
  let aA = amp[A],
    aB = amp[B],
    aC = amp[C],
    aD = amp[D];
  let oA = out[A],
    oB = out[B],
    oC = out[C],
    oD = out[D];
  let f1A = fb1[A],
    f1B = fb1[B],
    f1C = fb1[C],
    f1D = fb1[D];
  let f2A = fb2[A],
    f2B = fb2[B],
    f2C = fb2[C],
    f2D = fb2[D];
  // Width (#55), as the generic loop reads it: `ramp` advances the width each
  // sample, a Float32Array store's rounding made explicit; `sq` reads the wave
  // squeezed. Both are false for a width of exactly 1 that is not ramping, so
  // every patch before #55 takes the old read below, untouched.
  const width = voice.width,
    widthInc = voice.widthInc;
  const wiA = widthInc[A],
    wiB = widthInc[B],
    wiC = widthInc[C],
    wiD = widthInc[D];
  let wA = width[A],
    wB = width[B],
    wC = width[C],
    wD = width[D];
  const rampA = wiA !== 0,
    rampB = wiB !== 0,
    rampC = wiC !== 0,
    rampD = wiD !== 0;
  const sqA = kA !== KIND_NOISE && kA !== KIND_PULSE && (wA !== 1 || rampA);
  const sqB = kB !== KIND_NOISE && kB !== KIND_PULSE && (wB !== 1 || rampB);
  const sqC = kC !== KIND_NOISE && kC !== KIND_PULSE && (wC !== 1 || rampC);
  const sqD = kD !== KIND_NOISE && kD !== KIND_PULSE && (wD !== 1 || rampD);

  for (let s = 0; s < n; s++) {
    if (liveD) {
      const a = aD;
      let mod = 0;
      mod *= MOD_INDEX_SCALE;
      if (fbD !== 0) {
        const y = (f1D + f2D) * 0.5;
        mod += fbD > 0 ? y * fbD * FEEDBACK_SAW_CYCLES : -y * y * fbD * FEEDBACK_SQUARE_CYCLES;
      }
      let ph = phD + mod;
      ph -= Math.floor(ph);
      let v: number;
      if (sqD) {
        const pw = ph * wD;
        if (pw >= 1) v = 0;
        else if (kD === KIND_TABLE) {
          const fi = pw * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = tD[i0];
          v = s0 + (tD[i0 + 1] - s0) * (fi - i0);
        } else if (kD === KIND_SAW_D) v = pw * 2 - 1;
        else v = pw < 0.5 ? 1 : -1;
      } else if (kD === KIND_TABLE) {
        const fi = ph * TABLE_SIZE;
        const i0 = fi | 0;
        const s0 = tD[i0];
        v = s0 + (tD[i0 + 1] - s0) * (fi - i0);
      } else if (kD === KIND_NOISE) v = voice.noise();
      else if (kD === KIND_SAW_D) v = ph * 2 - 1;
      else if (kD === KIND_PULSE) {
        let pd = ph + wD;
        pd -= Math.floor(pd);
        const fi = ph * TABLE_SIZE;
        const i0 = fi | 0;
        const s0 = tD[i0];
        const up = s0 + (tD[i0 + 1] - s0) * (fi - i0);
        const fd = pd * TABLE_SIZE;
        const d0 = fd | 0;
        const sd = tD[d0];
        v = up - (sd + (tD[d0 + 1] - sd) * (fd - d0));
      } else v = ph < 0.5 ? 1 : -1;
      f2D = f1D;
      f1D = Math.fround(v * a);
      oD = Math.fround(v);
      aD = Math.fround(a + aiD);
    }
    phD += incD;
    if (phD >= 1) phD -= Math.floor(phD);
    if (rampD) wD = Math.fround(wD + wiD);

    if (liveC) {
      const a = aC;
      let mod = 0;
      if (modDC) mod += oD * aD;
      mod *= MOD_INDEX_SCALE;
      if (fbC !== 0) {
        const y = (f1C + f2C) * 0.5;
        mod += fbC > 0 ? y * fbC * FEEDBACK_SAW_CYCLES : -y * y * fbC * FEEDBACK_SQUARE_CYCLES;
      }
      let ph = phC + mod;
      ph -= Math.floor(ph);
      let v: number;
      if (sqC) {
        const pw = ph * wC;
        if (pw >= 1) v = 0;
        else if (kC === KIND_TABLE) {
          const fi = pw * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = tC[i0];
          v = s0 + (tC[i0 + 1] - s0) * (fi - i0);
        } else if (kC === KIND_SAW_D) v = pw * 2 - 1;
        else v = pw < 0.5 ? 1 : -1;
      } else if (kC === KIND_TABLE) {
        const fi = ph * TABLE_SIZE;
        const i0 = fi | 0;
        const s0 = tC[i0];
        v = s0 + (tC[i0 + 1] - s0) * (fi - i0);
      } else if (kC === KIND_NOISE) v = voice.noise();
      else if (kC === KIND_SAW_D) v = ph * 2 - 1;
      else if (kC === KIND_PULSE) {
        let pd = ph + wC;
        pd -= Math.floor(pd);
        const fi = ph * TABLE_SIZE;
        const i0 = fi | 0;
        const s0 = tC[i0];
        const up = s0 + (tC[i0 + 1] - s0) * (fi - i0);
        const fd = pd * TABLE_SIZE;
        const d0 = fd | 0;
        const sd = tC[d0];
        v = up - (sd + (tC[d0 + 1] - sd) * (fd - d0));
      } else v = ph < 0.5 ? 1 : -1;
      f2C = f1C;
      f1C = Math.fround(v * a);
      oC = Math.fround(v);
      aC = Math.fround(a + aiC);
    }
    phC += incC;
    if (phC >= 1) phC -= Math.floor(phC);
    if (rampC) wC = Math.fround(wC + wiC);

    if (liveB) {
      const a = aB;
      let mod = 0;
      if (modCB) mod += oC * aC;
      if (modDB) mod += oD * aD;
      mod *= MOD_INDEX_SCALE;
      if (fbB !== 0) {
        const y = (f1B + f2B) * 0.5;
        mod += fbB > 0 ? y * fbB * FEEDBACK_SAW_CYCLES : -y * y * fbB * FEEDBACK_SQUARE_CYCLES;
      }
      let ph = phB + mod;
      ph -= Math.floor(ph);
      let v: number;
      if (sqB) {
        const pw = ph * wB;
        if (pw >= 1) v = 0;
        else if (kB === KIND_TABLE) {
          const fi = pw * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = tB[i0];
          v = s0 + (tB[i0 + 1] - s0) * (fi - i0);
        } else if (kB === KIND_SAW_D) v = pw * 2 - 1;
        else v = pw < 0.5 ? 1 : -1;
      } else if (kB === KIND_TABLE) {
        const fi = ph * TABLE_SIZE;
        const i0 = fi | 0;
        const s0 = tB[i0];
        v = s0 + (tB[i0 + 1] - s0) * (fi - i0);
      } else if (kB === KIND_NOISE) v = voice.noise();
      else if (kB === KIND_SAW_D) v = ph * 2 - 1;
      else if (kB === KIND_PULSE) {
        let pd = ph + wB;
        pd -= Math.floor(pd);
        const fi = ph * TABLE_SIZE;
        const i0 = fi | 0;
        const s0 = tB[i0];
        const up = s0 + (tB[i0 + 1] - s0) * (fi - i0);
        const fd = pd * TABLE_SIZE;
        const d0 = fd | 0;
        const sd = tB[d0];
        v = up - (sd + (tB[d0 + 1] - sd) * (fd - d0));
      } else v = ph < 0.5 ? 1 : -1;
      f2B = f1B;
      f1B = Math.fround(v * a);
      oB = Math.fround(v);
      aB = Math.fround(a + aiB);
    }
    phB += incB;
    if (phB >= 1) phB -= Math.floor(phB);
    if (rampB) wB = Math.fround(wB + wiB);

    if (liveA) {
      const a = aA;
      let mod = 0;
      if (modBA) mod += oB * aB;
      if (modCA) mod += oC * aC;
      if (modDA) mod += oD * aD;
      mod *= MOD_INDEX_SCALE;
      if (fbA !== 0) {
        const y = (f1A + f2A) * 0.5;
        mod += fbA > 0 ? y * fbA * FEEDBACK_SAW_CYCLES : -y * y * fbA * FEEDBACK_SQUARE_CYCLES;
      }
      let ph = phA + mod;
      ph -= Math.floor(ph);
      let v: number;
      if (sqA) {
        const pw = ph * wA;
        if (pw >= 1) v = 0;
        else if (kA === KIND_TABLE) {
          const fi = pw * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = tA[i0];
          v = s0 + (tA[i0 + 1] - s0) * (fi - i0);
        } else if (kA === KIND_SAW_D) v = pw * 2 - 1;
        else v = pw < 0.5 ? 1 : -1;
      } else if (kA === KIND_TABLE) {
        const fi = ph * TABLE_SIZE;
        const i0 = fi | 0;
        const s0 = tA[i0];
        v = s0 + (tA[i0 + 1] - s0) * (fi - i0);
      } else if (kA === KIND_NOISE) v = voice.noise();
      else if (kA === KIND_SAW_D) v = ph * 2 - 1;
      else if (kA === KIND_PULSE) {
        let pd = ph + wA;
        pd -= Math.floor(pd);
        const fi = ph * TABLE_SIZE;
        const i0 = fi | 0;
        const s0 = tA[i0];
        const up = s0 + (tA[i0 + 1] - s0) * (fi - i0);
        const fd = pd * TABLE_SIZE;
        const d0 = fd | 0;
        const sd = tA[d0];
        v = up - (sd + (tA[d0 + 1] - sd) * (fd - d0));
      } else v = ph < 0.5 ? 1 : -1;
      f2A = f1A;
      f1A = Math.fround(v * a);
      oA = Math.fround(v);
      aA = Math.fround(a + aiA);
    }
    phA += incA;
    if (phA >= 1) phA -= Math.floor(phA);
    if (rampA) wA = Math.fround(wA + wiA);

    let sig = 0;
    if (carA) sig += oA * aA;
    if (carB) sig += oB * aB;
    if (carC) sig += oC * aC;
    if (carD) sig += oD * aD;
    sig *= gain;

    if (mode !== FILT_OFF) {
      if (drive !== 1) sig = softClip(sig * drive);
      sig = voice.svfA.process(sig, mode);
      if (slope24) sig = voice.svfB.process(sig, mode);
    }

    // The steal fade comes after the filter, so the voice reaches 0 at the
    // filter's output: a fade before it left a low cutoff ringing, and the
    // kill at the fade's end cut that tail to 0 in one sample (windsor#7).
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

  phase[A] = phA;
  phase[B] = phB;
  phase[C] = phC;
  phase[D] = phD;
  width[A] = wA;
  width[B] = wB;
  width[C] = wC;
  width[D] = wD;
  storeOperator(voice, A, liveA, n, aA, oA, f1A, f2A);
  storeOperator(voice, B, liveB, n, aB, oB, f1B, f2B);
  storeOperator(voice, C, liveC, n, aC, oC, f1C, f2C);
  storeOperator(voice, D, liveD, n, aD, oD, f1D, f2D);

  voice.fade = fade;
  if (fadeInc !== 0 && fade <= 0) {
    voice.kill();
  }
}

/**
 * Write one operator's kernel locals back. A skipped operator keeps its
 * amplitude and output, which only ever meet its amplitude of 0; its history
 * is what the generic loop's `v * 0` stores would have left.
 */
// eslint-disable-next-line max-params -- the kernel's locals for one operator, written back once per call
function storeOperator(
  voice: Voice,
  i: number,
  live: boolean,
  n: number,
  a: number,
  o: number,
  f1: number,
  f2: number,
): void {
  if (live) {
    voice.amp[i] = a;
    voice.out[i] = o;
    voice.fb1[i] = f1;
    voice.fb2[i] = f2;
    return;
  }
  if (n > 1) voice.fb2[i] = 0;
  else voice.fb2[i] = voice.fb1[i];
  voice.fb1[i] = 0;
}

export { renderVoiceKernel };
