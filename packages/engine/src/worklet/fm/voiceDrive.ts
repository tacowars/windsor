/* eslint-disable no-magic-numbers -- DSP: the soft clip's polynomial, the clamps and the fold's period are the curves; the tunables are fmConstants.ts */
/**
 * The voice's drive stage (windsor#300, record `2026-10-01-voice-drive-stage`):
 * after the carriers and before the filter, whether the filter is on or not.
 * `y = shape(gain · x + bias) − shape(bias)`, then a one-pole tone. The bias
 * shifts the curve's operating point for even harmonics, and subtracting
 * `shape(bias)` keeps silence silent with no DC blocker: the same arithmetic
 * on the same operand gives the same bits, so 0 in is exactly 0 out.
 * This module holds the stage's state, its curves and its control-rate half;
 * the per-sample arithmetic is written out in both render loops
 * (`voiceRender.ts`, `voiceKernel.ts`), `soft` and the tone pole inline and
 * any other shape through `curve`, since a call per sample cost the
 * soft-driven bank a third of its render (the research note
 * `docs/research/2026-10-01-voice-drive/README.md`).
 *
 * The shapes, by `DRIVE_SHAPE` id: `soft` is the filter's old soft clip, its
 * arithmetic unchanged, so a library patch renders bit for bit as it did;
 * `hard`, `diode`, `tube` and `fold` are Advanced Drive's curves of the same
 * names, here in arithmetic that gives the same bits on arm64 and x64 (tanh
 * through `inserts/tapePortableMath.ts`, the diode's powers through
 * `portablePowers.ts`, the fold by a floor). No oversampling: `hard` and
 * `fold` alias, by design.
 *
 * Invariants: unity gain with no bias is bypassed, and the loops do no work
 * for it; `curve` takes its operand from `point` and leaves its result
 * there, so no double crosses a call, and allocates nothing (worklet rule 2);
 * every double field is born NaN (rule 7). `updateVoiceDrive` is the
 * control-rate half, once per control block. `voiceDrive.test.ts` pins the
 * curves and the control half; `synth/fmProcessorDrive.test.ts` the loops
 * (silence, the bias's H2, the tone, both paths to the bit); the golden test
 * the library.
 */

import type { Voice } from './voice';
import {
  DRIVE_DIODE_LINEAR_BELOW,
  DRIVE_DIODE_ORDER,
  DRIVE_DIODE_ROOT,
  DRIVE_DIODE_UNITY_FROM,
  DRIVE_TONE_MIN_HZ,
  DRIVE_TONE_OCTAVES,
  DRIVE_TUBE_EVEN,
} from './fmConstants';
import { DRIVE_DIODE, DRIVE_FOLD, DRIVE_HARD, DRIVE_TUBE } from './modeIds';
import { exp2InPlace, log2InPlace } from './portablePowers';
import { tanhInPlace } from '../../inserts/tapePortableMath';

class VoiceDrive {
  /** Unity gain and no bias: bypassed, and the loops do no work for it. */
  on: boolean;
  /** The tone below 1: the pole runs. */
  toned: boolean;
  shape: number;
  gain: number;
  bias: number;
  /** `shape(bias)`, which the loops subtract so that silence stays silent. */
  offset: number;
  /** The tone pole's coefficient, g / (1 + g), and its state, which the loops carry between chunks. */
  toneCoef: number;
  toneState: number;
  /** `curve`'s operand and result. */
  point: number;
  /** The portable functions' one slot. */
  slot: Float64Array;

  constructor() {
    // Rule 7: each double field is born a double (NaN), before its start value (windsor#233).
    this.gain = this.bias = this.offset = this.toneCoef = this.toneState = NaN;
    this.point = NaN;
    this.on = false;
    this.toned = false;
    this.shape = 0;
    this.gain = 1;
    this.bias = 0;
    this.offset = 0;
    this.toneCoef = 1;
    this.toneState = 0;
    this.point = 0;
    this.slot = new Float64Array(1);
  }

  /** A new note: the tone pole starts from rest. */
  reset(): void {
    this.toneState = 0;
  }

  /** The curve at `point`, written back to `point`. */
  curve(): void {
    const x = this.point;
    switch (this.shape) {
      case DRIVE_HARD:
        this.point = x > 1 ? 1 : x < -1 ? -1 : x;
        return;
      case DRIVE_DIODE:
        this.diode();
        return;
      case DRIVE_TUBE: {
        const slot = this.slot;
        slot[0] = x;
        tanhInPlace(slot, 0);
        const t = slot[0];
        this.point = t + DRIVE_TUBE_EVEN * t * t;
        return;
      }
      case DRIVE_FOLD: {
        // A triangle of period 4 through (0, 0) and (1, 1): 2/π asin(sin(πx/2)).
        // An infinite operand has no phase (∞ − ∞ is NaN): it folds to 0. No
        // finite operand takes the branch, so their bits are unchanged.
        if (x - x !== 0) {
          this.point = 0;
          return;
        }
        let u = x + 1;
        u -= 4 * Math.floor(u * 0.25);
        this.point = 1 - Math.abs(u - 2);
        return;
      }
      default:
        // `soft`: the filter's soft clip before windsor#300, operation for
        // operation, as the loops write it out.
        this.point = x > 3 ? 1 : x < -3 ? -1 : (x * (27 + x * x)) / (27 + 9 * x * x);
    }
  }

  /** x / (1 + |x|^order)^(1/order) at `point`, as x · 2^(−log2(1 + 2^(order · log2|x|)) / order). */
  diode(): void {
    const x = this.point;
    const m = Math.abs(x);
    if (!(m >= DRIVE_DIODE_LINEAR_BELOW)) return; // the denominator rounds to 1 (or x is NaN)
    if (m >= DRIVE_DIODE_UNITY_FROM) {
      this.point = x > 0 ? 1 : -1;
      return;
    }
    const slot = this.slot;
    slot[0] = m;
    log2InPlace(slot, 0);
    slot[0] *= DRIVE_DIODE_ORDER;
    exp2InPlace(slot, 0);
    slot[0] += 1;
    log2InPlace(slot, 0);
    slot[0] *= -DRIVE_DIODE_ROOT;
    exp2InPlace(slot, 0);
    this.point = x * slot[0];
  }
}

/**
 * The drive's control-rate half, once per control block: the bypass, the
 * curve's value at the bias, and the tone's coefficient from the patch's
 * `drive` block, so a live edit is heard on the next block. A pole that is
 * not running holds no state, so the voice's quiet test never waits on it.
 * Allocates nothing.
 */
function updateVoiceDrive(voice: Voice): void {
  const d = voice.patch!.drive;
  const drive = voice.drive;
  drive.on = d.gain !== 1 || d.bias !== 0;
  drive.toned = drive.on && d.tone < 1;
  if (!drive.toned) drive.toneState = 0;
  if (!drive.on) return;
  drive.shape = d.shape;
  drive.gain = d.gain;
  drive.bias = d.bias;
  drive.point = d.bias;
  drive.curve();
  drive.offset = drive.point;
  if (!drive.toned) return;
  const slot = drive.slot;
  slot[0] = d.tone * DRIVE_TONE_OCTAVES;
  exp2InPlace(slot, 0);
  const g = (Math.PI * DRIVE_TONE_MIN_HZ * slot[0]) / voice.sr;
  drive.toneCoef = g / (1 + g);
}

export { VoiceDrive, updateVoiceDrive };
