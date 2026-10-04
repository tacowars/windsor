/**
 * The Acid Ladder on the voice (windsor#573, record
 * `2026-10-04-acid-ladder-filter-mode` decisions 4–8): its control-rate
 * half, as `voiceFormant.ts` is the Formant's, where `updateVoiceLadder`
 * hands the voice's live Reso to the ladder and tunes it and `tuneLadder`
 * works the ladder's coefficients out from its `cutoffHz` and `resonance`
 * fields; and `renderVoiceLadder`, its pass over a render chunk after the
 * sample loop.
 *
 * `updateVoiceFilter` (`voiceControl.ts`) works the cutoff out as the
 * serial modes' (the live cutoff, a lane's or a step's included, times
 * `2^octaves` of the envelope, wheel, both LFOs and key track) and leaves it
 * in the ladder's `cutoffHz` before it calls `updateVoiceLadder`. Then:
 *
 * - the cutoff is held to `LADDER_CUTOFF_MIN_HZ` .. `LADDER_CUTOFF_MAX_HZ`,
 *   and below `LADDER_CUTOFF_CEILING` of the sample rate, and the half-step
 *   h = tan(π f_c / (M f_s)) / 2^¼ for M sub-steps a sample;
 * - k = `LADDER_FEEDBACK_MAX` × p, p = log₂(reso / 0.5) / log₂ 24 held to
 *   0..1, so 0 at the knob's bottom (0.5) and 16.5 at its top (12), and
 *   the output mix's gain `LADDER_MIX_GAIN` × p (windsor#577);
 * - the makeup (1 + k)^`LADDER_MAKEUP_POWER` (windsor#587), the ladder's
 *   last gain, 1 at the knob's bottom and √17.5 (+12.4 dB) at its top,
 *   only when k changed: 2^(power × log₂(1 + k)) through `log2InPlace` and
 *   `exp2InPlace`, a scalar per control block and never per sample, which
 *   steps with the Reso at the cadence the loop's own k does;
 * - the feedback high-pass's G = g / (1 + g), g =
 *   tan(π `LADDER_FEEDBACK_HP_HZ` / (M f_s)), and the output mix's, g =
 *   tan(π `LADDER_MIX_HP_HZ` / f_s) (the mix runs once per output sample),
 *   once per sample rate.
 *
 * Each is worked out only when its input changed, so a held cutoff and
 * Reso cost three compares a block. The tangent, the log and the power are
 * `portableTangent.ts`'s and `portablePowers.ts`'s, so the coefficients are
 * the same bits on arm64 and x64; 2^¼ is a square root's, which IEEE rounds
 * exactly.
 *
 * Invariants: the tuning runs once per control block and the pass once per
 * render chunk, never per sample; both allocate nothing, and no double
 * crosses a call (worklet rule 2): the cutoff and the Reso arrive in the
 * ladder's fields, the transcendentals work in its `slot`, a sample passes
 * through its `point`, and the sample rate is an integer. Both render loops
 * call the same pass, so they stay bit-identical by construction.
 * `ladder.test.ts` pins the tuning; `synth/fmProcessorFilterLadder.test.ts`
 * the voice's, and `fmProcessorKernel.test.ts` the two loops.
 */

import type { Voice } from './voice';
import type { Ladder } from './ladder';
import {
  LADDER_CUTOFF_CEILING,
  LADDER_CUTOFF_MAX_HZ,
  LADDER_CUTOFF_MIN_HZ,
  LADDER_FEEDBACK_HP_HZ,
  LADDER_FEEDBACK_MAX,
  LADDER_MAKEUP_POWER,
  LADDER_MIX_GAIN,
  LADDER_MIX_HP_HZ,
  LADDER_RESONANCE_FLOOR,
  LADDER_RESONANCE_SPAN,
} from './fmConstants';
import { exp2InPlace, log2InPlace } from './portablePowers';
import { tanInPlace } from './portableTangent';
import { VT_RESONANCE } from './voiceTargetTables';

/** 2^−¼, the half-step's scale: ω_c τ = 2^¼. */
const LADDER_STEP_SCALE = Math.sqrt(Math.SQRT1_2);

/** log₂ of the Reso knob's span, in portable arithmetic, worked out once. */
const LADDER_SPAN_SLOT = new Float64Array(1);
LADDER_SPAN_SLOT[0] = LADDER_RESONANCE_SPAN;
log2InPlace(LADDER_SPAN_SLOT, 0);
const LADDER_LOG2_SPAN = LADDER_SPAN_SLOT[0];
const LADDER_RESONANCE_TOP = LADDER_RESONANCE_FLOOR * LADDER_RESONANCE_SPAN;

/**
 * The ladder's coefficients for its `cutoffHz` and `resonance` at `rate`
 * (Hz, an integer) and its `oversample`. Allocates nothing.
 */
function tuneLadder(ladder: Ladder, rate: number): void {
  const slot = ladder.slot;
  const stepRate = rate * ladder.oversample;
  if (rate !== ladder.tunedRate) {
    slot[0] = (Math.PI * LADDER_FEEDBACK_HP_HZ) / stepRate;
    tanInPlace(slot, 0);
    const g = slot[0];
    ladder.hpG = g / (1 + g);
    slot[0] = (Math.PI * LADDER_MIX_HP_HZ) / rate;
    tanInPlace(slot, 0);
    const gm = slot[0];
    ladder.mixG = gm / (1 + gm);
    ladder.tunedRate = rate;
    // The cutoff's ceiling and step answer to the rate too.
    ladder.tunedHz = NaN;
  }
  let fc = ladder.cutoffHz;
  const ceiling = LADDER_CUTOFF_CEILING * rate;
  const top = ceiling < LADDER_CUTOFF_MAX_HZ ? ceiling : LADDER_CUTOFF_MAX_HZ;
  if (fc > top) fc = top;
  if (!(fc >= LADDER_CUTOFF_MIN_HZ)) fc = LADDER_CUTOFF_MIN_HZ;
  if (fc !== ladder.tunedHz) {
    slot[0] = (Math.PI * fc) / stepRate;
    tanInPlace(slot, 0);
    ladder.h = slot[0] * LADDER_STEP_SCALE;
    ladder.tunedHz = fc;
  }
  const reso = ladder.resonance;
  if (reso !== ladder.tunedResonance) {
    let p: number;
    if (!(reso > LADDER_RESONANCE_FLOOR)) p = 0;
    else if (reso >= LADDER_RESONANCE_TOP) p = 1;
    else {
      slot[0] = reso / LADDER_RESONANCE_FLOOR;
      log2InPlace(slot, 0);
      p = slot[0] / LADDER_LOG2_SPAN;
      // The portable log is within ulps of log₂, so just under the top it may pass 1 by one.
      if (p > 1) p = 1;
    }
    const k = LADDER_FEEDBACK_MAX * p;
    if (k !== ladder.k) {
      // The makeup, (1 + k)^power: exactly 1 with no feedback, so the knob's bottom is the circuit's to the bit.
      if (k === 0) ladder.makeup = 1;
      else {
        slot[0] = 1 + k;
        log2InPlace(slot, 0);
        slot[0] *= LADDER_MAKEUP_POWER;
        exp2InPlace(slot, 0);
        ladder.makeup = slot[0];
      }
      ladder.k = k;
    }
    ladder.mixGain = LADDER_MIX_GAIN * p;
    ladder.tunedResonance = reso;
  }
}

/** This block's ladder: the live Reso onto it, `cutoffHz` already set, then `tuneLadder`. Allocates nothing. */
function updateVoiceLadder(voice: Voice): void {
  const ladder = voice.ladder;
  ladder.resonance = voice.liveValues[VT_RESONANCE];
  tuneLadder(ladder, voice.sr);
}

/**
 * The Acid mode's half of a render chunk, after either render loop: each
 * of the chunk's `n` samples the loop left in the ladder's `chunk` through the
 * ladder, then the steal fade from the chunk's start, as the loop runs it
 * after its filter, and the pan, added into the part's accumulators from
 * `off`. The loop ran its own fade on a 0 in the ladder's place and stores
 * it after this, so the fade read here is the chunk's first. One call a
 * chunk: a call left in the sample loop cost every mode's voices about
 * 1.5 ns a sample once an Acid voice had played, as V8 spilled the loop's
 * doubles around it (`docs/research/2026-10-04-acid-ladder-filter/`).
 * Allocates nothing; the ladder's sample passes through its `point`.
 */
function renderVoiceLadder(
  voice: Voice,
  outL: Float32Array,
  outR: Float32Array,
  off: number,
  n: number,
): void {
  const ladder = voice.ladder;
  const input = ladder.chunk;
  const panL = voice.panL,
    panR = voice.panR;
  const fadeInc = voice.fadeInc;
  let fade = voice.fade;
  for (let s = 0; s < n; s++) {
    ladder.point = input[s];
    ladder.process();
    let sig = ladder.point;
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
}

export { LADDER_STEP_SCALE, renderVoiceLadder, tuneLadder, updateVoiceLadder };
