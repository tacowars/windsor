/* eslint-disable no-magic-numbers -- DSP: the generic loop's feedback average, interpolation and mip arithmetic; the tunables are fmConstants.ts (#654) */
/**
 * The generic render loop (#645): four operators walked in the algorithm's
 * topological order, the carrier sum, the filter and the steal fade, over
 * locals hoisted out of the loop. It is the reference the fixed-index kernel
 * (`voiceKernel.js`) must match to the bit, and the path every voice takes
 * with `specialise: false`. Invariant: one sample loop, read top to bottom,
 * allocation free, no per-sample call beyond `voice.noise()` and the filter;
 * a helper per operator would reload the locals through the voice and cost
 * more than it saves. Width (#55): an operator whose width is exactly 1 and
 * still takes the old read, untouched; one squeezed reads its wave at
 * `phase / width` and holds 0 once that passes 1; a PULSE reads its saw
 * table twice. `fmProcessorKernel.test.ts` compares it with the kernel on
 * every preset; the golden test pins it.
 */

import type { Voice } from './voice';
import {
  FEEDBACK_SAW_CYCLES,
  FEEDBACK_SQUARE_CYCLES,
  MOD_INDEX_SCALE,
  TABLE_SIZE,
} from './fmConstants';
import { FILT_OFF } from './modeIds';
import { softClip } from './svf';
import { KIND_NOISE, KIND_PULSE, KIND_SAW_D, KIND_SQUARE_D } from './waveTables';

/**
 * Render `n` samples into the part's stereo accumulators starting at `off`.
 * Modulators are evaluated before carriers within the same sample, so there
 * is no one-sample delay in the FM chain; only self-feedback uses history.
 */
// One sample loop, read top to bottom. The operator pass, the carrier sum and
// the filter are three stages of a single computation over locals hoisted out
// of the loop; calling out to helpers per sample would reload them and cost
// more than the split reads.
// eslint-disable-next-line max-lines-per-function -- one hot loop, see above
function renderVoiceGeneric(
  voice: Voice,
  outL: Float32Array,
  outR: Float32Array,
  off: number,
  n: number,
): void {
  const patch = voice.patch!;
  const mods = voice.alg.mods;
  const carriers = voice.alg.carriers;
  const order = voice.order;
  const nCar = carriers.length;
  const carGain = 1 / Math.sqrt(nCar);
  const f = patch.filter;
  const mode = f.mode;
  const drive = f.drive;
  const slope24 = f.slope24;
  const gain = patch.volume * carGain;

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
  const width = voice.width,
    widthInc = voice.widthInc;
  const fbAmt = voice.opFeedback; // Float32Array(4): the patch's, or the step's (windsor#17)

  // Width (#55), one bit per operator, hoisted: `ramping` advances its width
  // each sample, `squeezed` reads its wave compressed. Neither is set for a
  // width of exactly 1 that is not ramping, which is every patch before #55.
  let ramping = 0,
    squeezed = 0;
  for (let i = 0; i < 4; i++) {
    const bit = 1 << i;
    if (widthInc[i] !== 0) ramping |= bit;
    const k = kind[i];
    if (k !== KIND_NOISE && k !== KIND_PULSE && (width[i] !== 1 || widthInc[i] !== 0)) {
      squeezed |= bit;
    }
  }

  for (let s = 0; s < n; s++) {
    for (let oi = 0; oi < 4; oi++) {
      const i = order[oi];
      const a = amp[i];

      // Sum modulators, then add self-feedback on the operator's last two
      // outputs (averaged to damp the buzz single-sample feedback produces).
      let mod = 0;
      const m = mods[i];
      for (let j = 0; j < m.length; j++) {
        const src = m[j];
        mod += out[src] * amp[src];
      }
      mod *= MOD_INDEX_SCALE;
      const fb = fbAmt[i];
      if (fb !== 0) {
        const y = (fb1[i] + fb2[i]) * 0.5;
        mod += fb > 0 ? y * fb * FEEDBACK_SAW_CYCLES : -y * y * fb * FEEDBACK_SQUARE_CYCLES;
      }

      let ph = phase[i] + mod;
      ph -= Math.floor(ph);

      let v: number;
      if ((squeezed & (1 << i)) !== 0) {
        // The wave runs at 1 / width through the first `width` of the period,
        // then holds 0. Reading at exactly 1 would interpolate past the guard
        // sample, so the hold is its own branch.
        const pw = ph * width[i];
        const k = kind[i];
        if (pw >= 1) v = 0;
        else if (k === KIND_SAW_D) v = pw * 2 - 1;
        else if (k === KIND_SQUARE_D) v = pw < 0.5 ? 1 : -1;
        else {
          const t = tables[i]!;
          const fi = pw * TABLE_SIZE;
          const i0 = fi | 0;
          const s0 = t[i0];
          v = s0 + (t[i0 + 1] - s0) * (fi - i0);
        }
      } else {
        switch (kind[i]) {
          case KIND_NOISE:
            v = voice.noise();
            break;
          case KIND_SAW_D:
            v = ph * 2 - 1;
            break;
          case KIND_SQUARE_D:
            v = ph < 0.5 ? 1 : -1;
            break;
          case KIND_PULSE: {
            // Two reads of the saw, the second a duty later: a band-limited
            // pulse, zero-mean at any duty.
            const t = tables[i]!;
            let pd = ph + width[i];
            pd -= Math.floor(pd);
            const fi = ph * TABLE_SIZE;
            const i0 = fi | 0;
            const s0 = t[i0];
            const up = s0 + (t[i0 + 1] - s0) * (fi - i0);
            const fd = pd * TABLE_SIZE;
            const d0 = fd | 0;
            const sd = t[d0];
            const down = sd + (t[d0 + 1] - sd) * (fd - d0);
            v = up - down;
            break;
          }
          default: {
            const t = tables[i]!;
            const fi = ph * TABLE_SIZE;
            const i0 = fi | 0;
            const frac = fi - i0;
            const s0 = t[i0];
            v = s0 + (t[i0 + 1] - s0) * frac;
            break;
          }
        }
      }

      fb2[i] = fb1[i];
      fb1[i] = v * a;
      out[i] = v;

      phase[i] += phaseInc[i];
      if (phase[i] >= 1) phase[i] -= Math.floor(phase[i]);
      if ((ramping & (1 << i)) !== 0) width[i] += widthInc[i];
      amp[i] = a + ampInc[i];
    }

    let sig = 0;
    for (let c = 0; c < nCar; c++) {
      const i = carriers[c];
      sig += out[i] * amp[i];
    }
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
    outL[k] += sig * voice.panL;
    outR[k] += sig * voice.panR;
  }

  voice.fade = fade;
  if (fadeInc !== 0 && fade <= 0) {
    voice.kill();
  }
}

export { renderVoiceGeneric };
