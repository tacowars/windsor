/**
 * Spectre's controls (record `2026-10-16-spectre-insert`): each quantum's
 * params read into typed fields and slots, the curves into
 * `SpectreCurveSet`, and the continuous moves glided once a frame.
 *
 * - **Choices** (resolution, overlap, window, algorithm, LFO shape, the LFO
 *   slots' destinations, Freeze's mode) are read as rounded indices; the DSP
 *   decides what a change costs.
 * - **The moves** (`SPECTRE_SMOOTHED`, slot by slot) glide toward their
 *   targets with a one-pole of `SPECTRE_DSP.smoothSeconds` at the frame
 *   rate, landing exactly within `SNAP` so the loop goes idle; the first
 *   quantum snaps them.
 * - **The curves** are not params: the processor copies their posted cells
 *   into `SpectreCellSet` (record `2026-10-17-spectre-drawn-cells`).
 *
 * Invariants: `read` and `step` allocate nothing and pass no double across a
 * call (worklet rule 2); every double field is born NaN (rule 7). Pinned by
 * `inserts/spectreAllocation.test.ts`.
 */
import { SPECTRE_DSP } from '../../inserts/spectreConstants';

type SpectreParams = Record<string, Float32Array>;

/** The moves that glide, in slot order. */
const SPECTRE_SMOOTHED = [
  'gainShift',
  'delayShift',
  'feedbackShift',
  'gainOffset',
  'delayOffset',
  'feedbackOffset',
  'scatter',
  'spread',
  'modA',
  'modB',
  'modC',
  'lfoDepth1',
  'lfoDepth2',
  'lfoDepth3',
  'gainSelect',
  'delaySelect',
  'feedbackSelect',
] as const;
const SNAP = 1e-6;
/** The LFO's slots, each a destination and a depth. */
const SPECTRE_LFO_SLOTS = 3;

class SpectreControls {
  readonly target: Float64Array;
  readonly value: Float64Array;
  /** The glide's step a frame. */
  pole: number;
  snapped: boolean;
  bands: number;
  overlap: number;
  window: number;
  mod: number;
  lfoShape: number;
  /** Each LFO slot's destination, a `SPECTRE_LFO_DESTS` index. */
  readonly lfoDests: Int32Array;
  /** Carve (1) keeps the drawn feedback while frozen; Hold (0) lifts it to full. */
  freezeMode: number;
  /** The selection follows: 0 nothing, 1 the key, 2 the chord; and the pitch classes handed in. */
  follow: number;
  pitches: number;
  timeMs: number;
  gridMs: number;
  lfoHz: number;
  freeze: boolean;
  enabled: boolean;
  mix: number;
  outputDb: number;

  constructor() {
    this.pole = this.timeMs = this.gridMs = this.lfoHz = this.mix = this.outputDb = NaN;
    this.target = new Float64Array(SPECTRE_SMOOTHED.length);
    this.value = new Float64Array(SPECTRE_SMOOTHED.length);
    this.lfoDests = new Int32Array(SPECTRE_LFO_SLOTS);
    this.pole = 1;
    this.snapped = false;
    this.bands = this.overlap = this.window = this.mod = this.lfoShape = this.freezeMode = 0;
    this.follow = this.pitches = 0;
    this.timeMs = this.gridMs = this.lfoHz = this.mix = this.outputDb = 0;
    this.freeze = false;
    this.enabled = true;
  }

  /** The quantum's params into the fields and the targets. */
  read(params: SpectreParams): void {
    const on = SPECTRE_DSP.switchOn;
    this.bands = Math.round(params.bands[0]);
    this.overlap = Math.round(params.overlap[0]);
    this.window = Math.round(params.window[0]);
    this.mod = Math.round(params.mod[0]);
    this.lfoShape = Math.round(params.lfoShape[0]);
    this.lfoDests[0] = Math.round(params.lfoDest1[0]);
    this.lfoDests[1] = Math.round(params.lfoDest2[0]);
    this.lfoDests[2] = Math.round(params.lfoDest3[0]);
    this.freezeMode = Math.round(params.freezeMode[0]);
    this.follow = Math.round(params.follow[0]);
    this.pitches = Math.round(params.pitches[0]);
    this.freeze = params.freeze[0] >= on;
    this.enabled = params.enabled[0] >= on;
    this.timeMs = params.timeMs[0];
    this.gridMs = params.gridMs[0];
    this.lfoHz = params.lfoHz[0];
    this.mix = params.mix[0];
    this.outputDb = params.outputDb[0];
    const target = this.target;
    for (let s = 0; s < SPECTRE_SMOOTHED.length; s++) target[s] = params[SPECTRE_SMOOTHED[s]][0];
    if (!this.snapped) {
      this.value.set(target);
      this.snapped = true;
    }
  }

  /** One frame of glide. */
  step(): void {
    const target = this.target,
      value = this.value,
      pole = this.pole;
    for (let s = 0; s < SPECTRE_SMOOTHED.length; s++) {
      const gap = target[s] - value[s];
      if (gap === 0) continue;
      value[s] = gap < SNAP && gap > -SNAP ? target[s] : value[s] + pole * gap;
    }
  }
}

const SLOT_GAIN_SHIFT = 0,
  SLOT_DELAY_SHIFT = 1,
  SLOT_FEEDBACK_SHIFT = 2,
  SLOT_GAIN_OFFSET = 3,
  SLOT_DELAY_OFFSET = 4,
  SLOT_FEEDBACK_OFFSET = 5,
  SLOT_SCATTER = 6,
  SLOT_SPREAD = 7,
  SLOT_MOD_A = 8,
  SLOT_MOD_B = 9,
  SLOT_MOD_C = 10,
  SLOT_LFO_DEPTH = 11,
  SLOT_GAIN_SELECT = 14,
  SLOT_DELAY_SELECT = 15,
  SLOT_FEEDBACK_SELECT = 16;

export {
  SLOT_DELAY_OFFSET,
  SLOT_DELAY_SELECT,
  SLOT_DELAY_SHIFT,
  SLOT_FEEDBACK_OFFSET,
  SLOT_FEEDBACK_SELECT,
  SLOT_FEEDBACK_SHIFT,
  SLOT_GAIN_OFFSET,
  SLOT_GAIN_SELECT,
  SLOT_GAIN_SHIFT,
  SLOT_LFO_DEPTH,
  SLOT_MOD_A,
  SLOT_MOD_B,
  SLOT_MOD_C,
  SLOT_SCATTER,
  SLOT_SPREAD,
  SPECTRE_LFO_SLOTS,
  SpectreControls,
};
export type { SpectreParams };
