/**
 * The Tape insert's magnetic stage (windsor#224, epic #146 milestone E2):
 * the state `TapeDsp` keeps around E1's core, per the decisions of
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`.
 *
 * - Two `TapeOversampler`s per channel, one at 2× and one at 4× (decision
 *   1), built here; `select` picks the pair for the `oversampling`
 *   parameter and starts a newly selected pair from zero state.
 * - The core's three controls, smoothed per block toward the selected
 *   model's row with the insert's 10 ms time constant, the magnetization
 *   kept; both pairs are reconfigured only when they moved (decision 6).
 *   The idle pair is configured with the active one, so a switch only
 *   resets the pair it selects (windsor#228): a switch is rare, and a
 *   reconfiguration there ran in V8's lower tiers, which box every double.
 * - The dry ring: `latency` samples per channel, so Mix and bypass read a
 *   dry signal exactly as late as the pair's fixed delay (decision 4).
 * - The developer override (windsor#276): `setOverride` sets the target to an
 *   allowed row in place of the model's, through the same smoothing with
 *   the magnetization kept, until a `null` row hands it back to the model.
 *   A row out of [0, 1] or not above the susceptibility floor is refused,
 *   never clamped. Without one, `configure` runs exactly as before.
 *
 * `TapeDsp.channel` drives the active oversampler through its `input`,
 * `advance()` and `output` fields and reads the ring in place, so no double
 * crosses a call per sample (worklet rules 2 and 7).
 *
 * Invariants: every oversampler and buffer is allocated in the constructor;
 * `select` and `configure` allocate nothing, and the smoothing coefficient
 * comes from `exp2`, not `Math.exp`, so the render is the same bits on
 * arm64 and x64. Pinned by `inserts/tapeMagneticIntegration.test.ts`
 * (both factors, the switch from zero state, allocation across a switch)
 * and `inserts/tapeMagneticOverride.test.ts` (the override).
 */
import { TAPE_DSP as C, TAPE_MODELS, TAPE_OVERSAMPLING } from '../../inserts/tapeConstants';
import { TAPE_MAGNETIC, type TapeMagneticControls } from '../../inserts/tapeMagneticConstants';
import { exp2 } from '../../inserts/tapePortableMath';
import { TAPE_PORTABLE_MATH } from '../../inserts/tapePortableMathTables';
import { magneticControls, magneticRowAboveFloor, magneticRowInRange } from './tapeMagneticRows';
import { TapeOversampler } from './tapeOversample';

const CHANNELS = 2;

class TapeMagneticStage {
  rate: number;
  /** Channel-major: `[left 2×, left 4×, right 2×, right 4×]`, in `TAPE_OVERSAMPLING` order. */
  oversamplers: TapeOversampler[];
  /** The pair in use, one per channel. */
  active: TapeOversampler[];
  factor: number;
  /** The pair's fixed delay in host samples, the dry ring's length per channel. */
  latency: number;
  /** Channel-major dry history: `latency` samples of each channel. */
  dry: Float64Array;
  dryAt: number;
  /** The smoothed core controls, the ones last configured, and the selected model's row (or the override). */
  controls: TapeMagneticControls;
  configured: TapeMagneticControls;
  target: TapeMagneticControls;
  /** Whether `target` holds the developer override rather than the model's row. */
  overridden: boolean;
  /** Where `setOverride` checks a row, so the check allocates nothing. */
  candidate: TapeMagneticControls;
  /** The smoothing coefficient for a block of `smoothFrames` samples, recomputed only when that changes. */
  smoothing: number;
  smoothFrames: number;

  constructor(rate: number, factor: number, model: number) {
    this.rate = rate;
    this.oversamplers = [];
    for (let channel = 0; channel < CHANNELS; channel++)
      for (const f of TAPE_OVERSAMPLING) this.oversamplers.push(new TapeOversampler(rate, f));
    this.latency = TAPE_MAGNETIC.span;
    this.dry = new Float64Array(CHANNELS * this.latency);
    this.dryAt = 0;
    this.smoothing = NaN;
    this.smoothFrames = NaN;
    const row = TAPE_MODELS[model].magnetic;
    this.target = magneticControls(row, { drive: NaN, width: NaN, saturation: NaN });
    this.controls = magneticControls(row, { drive: NaN, width: NaN, saturation: NaN });
    this.configured = magneticControls(row, { drive: NaN, width: NaN, saturation: NaN });
    this.overridden = false;
    this.candidate = magneticControls(row, { drive: NaN, width: NaN, saturation: NaN });
    for (let i = 0; i < this.oversamplers.length; i++)
      this.oversamplers[i].configure(this.controls);
    this.active = [this.oversamplers[0], this.oversamplers[TAPE_OVERSAMPLING.length]];
    this.factor = TAPE_OVERSAMPLING[0];
    this.select(factor);
  }

  /**
   * The pair for `value`, the nearest of `TAPE_OVERSAMPLING`. A change resets
   * the newly selected pair to zero state; it is already configured from the
   * smoothed controls, as `configure` keeps both pairs. The pair it leaves
   * keeps its state until it is selected again, when it too starts from zero.
   */
  select(value: number): void {
    const index = value >= (TAPE_OVERSAMPLING[0] + TAPE_OVERSAMPLING[1]) / 2 ? 1 : 0;
    const factor = TAPE_OVERSAMPLING[index];
    if (factor === this.factor) return;
    this.factor = factor;
    for (let channel = 0; channel < CHANNELS; channel++) {
      const next = this.oversamplers[channel * TAPE_OVERSAMPLING.length + index];
      next.reset();
      this.active[channel] = next;
    }
  }

  /**
   * The developer override (windsor#276): glide to `row` in place of the
   * model's row, or back to the model's at `null`. Returns false, and
   * changes nothing, for anything but three numbers in [0, 1] above the floor. Not on
   * the per-block path: the processor calls it from its port.
   */
  setOverride(row: unknown): boolean {
    if (row === null) {
      this.overridden = false;
      return true;
    }
    if (!magneticRowInRange(row) || !magneticRowAboveFloor(row, this.candidate)) return false;
    magneticControls(row, this.target);
    this.overridden = true;
    return true;
  }

  /**
   * Once per block: smooth the core's controls toward `model`'s row (or the
   * override) over `frames` samples with the 10 ms time constant, and
   * reconfigure both pairs when they moved. While every row is equal and
   * there is no override this changes nothing.
   */
  configure(model: number, frames: number): void {
    if (!this.overridden) magneticControls(TAPE_MODELS[model].magnetic, this.target);
    if (frames !== this.smoothFrames) {
      this.smoothFrames = frames;
      this.smoothing = 1 - exp2(-frames / (this.rate * C.smoothSeconds * TAPE_PORTABLE_MATH.ln2));
    }
    const k = this.smoothing,
      s = this.controls,
      t = this.target,
      last = this.configured;
    // Each glides toward its target and snaps once within an ulp, so a finished glide stops reconfiguring.
    s.drive += k * (t.drive - s.drive);
    if (Math.abs(t.drive - s.drive) < Number.EPSILON) s.drive = t.drive;
    s.width += k * (t.width - s.width);
    if (Math.abs(t.width - s.width) < Number.EPSILON) s.width = t.width;
    s.saturation += k * (t.saturation - s.saturation);
    if (Math.abs(t.saturation - s.saturation) < Number.EPSILON) s.saturation = t.saturation;
    if (s.drive === last.drive && s.width === last.width && s.saturation === last.saturation)
      return;
    last.drive = s.drive;
    last.width = s.width;
    last.saturation = s.saturation;
    for (let i = 0; i < this.oversamplers.length; i++) this.oversamplers[i].configure(s);
  }
}

export { TapeMagneticStage };
