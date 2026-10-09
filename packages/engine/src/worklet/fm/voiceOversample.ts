/**
 * The synced voice at twice the rate (windsor#656, record
 * `2026-10-09-sync-voice-at-2x`; candidate AB2 + D of
 * `docs/research/2026-10-09-sync-antialias-study/`): a voice that plays a
 * synced operator renders its operators at `SYNC_OVERSAMPLE` times the
 * part's rate and decimates their carrier sum before the drive, so a reset's
 * step and the direct shape's edges fold from twice as high.
 *
 * **Which voices.** One whose patch has an operator with `sync` not `'off'`,
 * unless the patch has an operator with feedback not 0 or a Noise operator
 * (`patchOversamples`): feedback's two-sample average and the noise draw
 * would change sound at another rate. The rate is chosen at the note-on and
 * kept for the voice's life (`startVoiceOversample`); a live edit or a lane
 * that changes sync or feedback mid-note plays at the voice's rate, and the
 * next note takes the new one.
 *
 * **What runs at twice the rate**: the operators (their phases, amplitude
 * ramps and knots, envelopes, widths, own filters, the resets and the direct
 * shape's edges) and the carrier sum, over the voice's `opRate`; the control
 * update keeps its interval in the part's samples, so it updates as often in
 * time. **Then** the sum is decimated (`decimateVoiceSums`) through the drive
 * oversampler's FIR, shared from `advancedDrive/driveOversample.ts`, a
 * 65-tap Blackman-windowed sinc at 0.235 of the doubled rate, whose 16-sample
 * (0.333 ms at 48 kHz) delay is not compensated. The drive, the filter, the
 * steal fade and the pan run at the part's rate, as for any voice
 * (`renderVoicePost`).
 *
 * Invariant: a voice at 1× never reaches the decimator, and its sums pass
 * through `oversample.sums` unchanged (`renderVoiceGeneric`). Every buffer is
 * allocated with the voice; the render allocates nothing, and no double
 * crosses a call. `synth/fmProcessorOversample.test.ts` pins the choice,
 * the delay, the level and the lifecycle; `voiceOversample.test.ts` the
 * decimator; `fmProcessorAllocation.test.ts` the allocation.
 */

import type { Patch } from '../../patch/patch';
import type { Voice } from './voice';
import { DRIVE_OVERSAMPLE_FIR } from '../advancedDrive/driveOversample';
import { CTRL_INTERVAL_LONG, DORMANT_AMP, SYNC_OVERSAMPLE } from './fmConstants';
import { OPERATOR_COUNT } from './patchDefaults';
import { renderVoiceOperators, renderVoicePost } from './voiceRender';
import { WAVE } from './waveIds';

/** The decimator's taps, and its half: the centre tap and the delay in samples at the doubled rate. */
const OVERSAMPLE_TAPS = DRIVE_OVERSAMPLE_FIR.length;
const OVERSAMPLE_HALF = (OVERSAMPLE_TAPS - 1) >> 1;

/** One voice's rate and the decimator's state. */
class VoiceOversample {
  /** The part's switch: false keeps every voice at 1× (a test's "before" render). */
  allowed: boolean;
  /** 1, or `SYNC_OVERSAMPLE` for a note that took twice the rate. */
  factor: number;
  /** The carrier sums of a render call at the operators' rate, decimated in place. */
  sums: Float64Array;
  /** The decimator's delay line, doubled so a window never wraps: the newest sample at `at − 1`. */
  ring: Float64Array;
  at: number;

  constructor() {
    this.allowed = true;
    this.factor = 1;
    this.sums = new Float64Array(SYNC_OVERSAMPLE * CTRL_INTERVAL_LONG);
    this.ring = new Float64Array(2 * OVERSAMPLE_TAPS);
    this.at = 0;
  }
}

/** Whether a note of `patch` runs at twice the rate: a synced operator, and none fed or Noise. */
function patchOversamples(patch: Patch): boolean {
  let synced = false;
  for (let i = 0; i < OPERATOR_COUNT; i++) {
    const op = patch.ops[i]!;
    if (op.wave === WAVE.NOISE || op.feedback !== 0) return false;
    if (op.sync !== 'off') synced = true;
  }
  return synced;
}

/**
 * The note-on's rate (before the envelopes are configured): the factor, the
 * operators' rate and an empty delay line. An operator's own filters retune
 * at the next bind when the rate changed, as their cutoffs are prewarped at
 * it. Allocates nothing.
 */
function startVoiceOversample(voice: Voice, patch: Patch): void {
  const os = voice.oversample;
  os.factor = os.allowed && patchOversamples(patch) ? SYNC_OVERSAMPLE : 1;
  const rate = voice.sr * os.factor;
  if (rate !== voice.opRate) {
    for (let i = 0; i < OPERATOR_COUNT; i++) {
      const filter = voice.opFilter[i]!;
      filter.lpHz = filter.hpHz = NaN;
    }
  }
  voice.opRate = rate;
  os.ring.fill(0);
  os.at = 0;
}

/**
 * The first `2n` sums, at the doubled rate, decimated into the first `n`:
 * output `s` is the FIR over the 65 inputs up to `2s`, the doubled rate's
 * sample at the part's instant `s`, so it is that instant's 32 inputs of
 * delay, 16 samples at the part's rate exactly; input `2s + 1` joins the
 * line after it. The symmetric taps are folded so each pair takes one
 * multiply. Output `s` reads inputs `2s` and `2s + 1` before it is written,
 * so the pass runs in place. Allocates nothing.
 */
function decimateVoiceSums(os: VoiceOversample, n: number): void {
  const h = DRIVE_OVERSAMPLE_FIR;
  const ring = os.ring,
    sums = os.sums;
  let at = os.at;
  for (let s = 0; s < n; s++) {
    const even = sums[SYNC_OVERSAMPLE * s];
    ring[at] = even;
    ring[at + OVERSAMPLE_TAPS] = even;
    if (++at === OVERSAMPLE_TAPS) at = 0;
    // The window, oldest first, is ring[at .. at + OVERSAMPLE_TAPS).
    const last = at + OVERSAMPLE_TAPS - 1;
    let y = h[OVERSAMPLE_HALF] * ring[at + OVERSAMPLE_HALF];
    for (let k = 0; k < OVERSAMPLE_HALF; k++) y += h[k] * (ring[at + k] + ring[last - k]);
    const odd = sums[SYNC_OVERSAMPLE * s + 1];
    ring[at] = odd;
    ring[at + OVERSAMPLE_TAPS] = odd;
    if (++at === OVERSAMPLE_TAPS) at = 0;
    sums[s] = y;
  }
  os.at = at;
}

/** Whether any of `voices` sounds at twice the rate: a patch message then builds the sets it may rebind to. */
function anyVoiceOversampled(voices: Voice[]): boolean {
  for (let i = 0; i < voices.length; i++) {
    if (voices[i]!.active && voices[i]!.oversample.factor !== 1) return true;
  }
  return false;
}

/** Whether the decimator has nothing left to send: every sample in its delay line under the dormancy floor. */
function oversampleQuiet(os: VoiceOversample): boolean {
  if (os.factor === 1) return true;
  const ring = os.ring;
  for (let k = 0; k < OVERSAMPLE_TAPS; k++) {
    const v = ring[k];
    if (v > DORMANT_AMP || v < -DORMANT_AMP) return false;
  }
  return true;
}

/**
 * Render `n` samples of a voice at twice the rate into the part's stereo
 * accumulators starting at `off`: its operators over `2n`, the sums
 * decimated to `n`, then the drive, the filter, the fade and the pan.
 */
function renderVoiceOversampled(
  voice: Voice,
  outL: Float32Array,
  outR: Float32Array,
  off: number,
  n: number,
): void {
  renderVoiceOperators(voice, n * SYNC_OVERSAMPLE);
  decimateVoiceSums(voice.oversample, n);
  renderVoicePost(voice, outL, outR, off, n);
}

export {
  OVERSAMPLE_HALF,
  VoiceOversample,
  anyVoiceOversampled,
  decimateVoiceSums,
  oversampleQuiet,
  patchOversamples,
  renderVoiceOversampled,
  startVoiceOversample,
};
