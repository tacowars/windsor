/**
 * The generic render loop (#645): four operators walked in the algorithm's
 * topological order, the carrier sum, the steal fade and the filter, over
 * locals hoisted out of the loop. It is the reference the fixed-index kernel
 * (`voiceKernel.js`) must match to the bit, and the path every voice takes
 * with `specialise: false`. Invariant: one sample loop, read top to bottom,
 * allocation free, no per-sample call beyond `voice.noise()` and the filter;
 * a helper per operator would reload the locals through the voice and cost
 * more than it saves. `fmProcessorKernel.test.ts` compares it with the kernel
 * on every preset; the golden test pins it.
 */

import {
  FEEDBACK_SAW_CYCLES,
  FEEDBACK_SQUARE_CYCLES,
  MOD_INDEX_SCALE,
  TABLE_SIZE,
} from './fmConstants.js';
import { FILT_OFF, softClip } from './svf.js';
import { KIND_NOISE, KIND_SAW_D, KIND_SQUARE_D } from './waveTables.js';

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
function renderVoiceGeneric(voice, outL, outR, off, n) {
  const patch = voice.patch;
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
  const fbAmt = patch.feedbackScratch; // Float32Array(4), refreshed by the part

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

      let v;
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
        default: {
          const t = tables[i];
          const fi = ph * TABLE_SIZE;
          const i0 = fi | 0;
          const frac = fi - i0;
          const s0 = t[i0];
          v = s0 + (t[i0 + 1] - s0) * frac;
          break;
        }
      }

      fb2[i] = fb1[i];
      fb1[i] = v * a;
      out[i] = v;

      phase[i] += phaseInc[i];
      if (phase[i] >= 1) phase[i] -= Math.floor(phase[i]);
      amp[i] = a + ampInc[i];
    }

    let sig = 0;
    for (let c = 0; c < nCar; c++) {
      const i = carriers[c];
      sig += out[i] * amp[i];
    }
    sig *= gain;

    if (fadeInc !== 0) {
      fade += fadeInc;
      if (fade <= 0) {
        fade = 0;
      }
      sig *= fade;
    }

    if (mode !== FILT_OFF) {
      if (drive !== 1) sig = softClip(sig * drive);
      sig = voice.svfA.process(sig, mode);
      if (slope24) sig = voice.svfB.process(sig, mode);
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
