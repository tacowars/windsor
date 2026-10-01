/**
 * The Tape insert's magnetic stage (windsor#224, epic #146 milestone E2):
 * the state `TapeDsp` keeps around E1's core, per the decisions of
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`.
 *
 * - Two `TapeOversampler`s per channel, one at 2× and one at 4× (decision
 *   1), built here; `select` picks the pair for the `oversampling`
 *   parameter and starts a newly selected pair from zero state.
 * - The core's three controls, glided toward the selected model's row, or
 *   toward the song's `core` while one is set (`overridden`, `custom`:
 *   the Advanced section, windsor#291, inside `TAPE_CORE_BOUNDS`),
 *   with the insert's 10 ms time constant, the magnetization kept
 *   (decision 6). `configure` (per block) sets the target and starts a
 *   glide when it moved; `glide` (per sample, only while gliding) steps the controls and
 *   retunes the active pair, so the core's coefficients and normalisation
 *   never step more than one sample's worth (the 2026-10-01 amendment to
 *   decision 6), and each retune rescales the magnetization so the core's
 *   output, M × gain, is continuous (windsor#296). Within `TAPE_DSP.magneticSnap` of the row the glide snaps
 *   to it exactly, retunes all four cores and stops, so a settled render is
 *   the constant-control render, bit for bit. The idle pair is retuned
 *   there with the active one, so a factor switch only resets the pair it
 *   selects (windsor#228); one selected mid-glide is retuned by the next
 *   sample's `glide` before it runs.
 * - The dry ring: `latency` samples per channel, so Mix and bypass read a
 *   dry signal exactly as late as the pair's fixed delay (decision 4).
 *
 * `TapeDsp.channel` drives the active oversampler through its `input`,
 * `advance()` and `output` fields and reads the ring in place, so no double
 * crosses a call per sample (worklet rules 2 and 7).
 *
 * Invariants: every oversampler and buffer is allocated in the constructor;
 * `select`, `configure` and `glide` allocate nothing and pass no double, and
 * the glide coefficient comes from `exp2`, not `Math.exp`, so the render is
 * the same bits on arm64 and x64. Pinned by
 * `inserts/tapeMagneticIntegration.test.ts` (both factors, the switch from
 * zero state, allocation across a switch) and `inserts/tapeModelSwitch.test.ts`
 * (every model pair inside the steady envelope, the settled glide, and a
 * song's `core` held through a walk and cleared), with
 * `inserts/tapeCoreSweep.test.ts` (each core knob swept under a tone).
 */
import { TAPE_DSP as C, TAPE_MODELS, TAPE_OVERSAMPLING } from '../../inserts/tapeConstants';
import { TAPE_MAGNETIC, type TapeMagneticControls } from '../../inserts/tapeMagneticConstants';
import { exp2 } from '../../inserts/tapePortableMath';
import { TAPE_PORTABLE_MATH } from '../../inserts/tapePortableMathTables';
import { magneticControls } from './tapeMagneticRows';
import { TapeOversampler } from './tapeOversample';

const CHANNELS = 2;

/**
 * The core's three controls as the stage holds them, every one born a double
 * (worklet rule 7). A class, not a literal: a literal's map is shared with
 * every other `{ drive, width, saturation }` in the bundle, and
 * `TAPE_CORE_BOUNDS` (arrays under those names) made its fields heap
 * objects, so each write of a double took a new heap number, three a block
 * (windsor#291).
 */
class TapeCoreControls implements TapeMagneticControls {
  drive: number;
  width: number;
  saturation: number;
  constructor() {
    this.drive = this.width = this.saturation = NaN;
  }
}

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
  /** The gliding core controls and the selected model's row, or the song's `core`. */
  controls: TapeCoreControls;
  target: TapeCoreControls;
  /** True while the song sets the core's controls (windsor#291); `custom` holds them. */
  overridden: boolean;
  custom: TapeCoreControls;
  /** True from a change of row until the controls reach it; `TapeDsp.step` calls `glide` only then. */
  gliding: boolean;
  /** One sample's glide coefficient for the 10 ms time constant, and the distance that ends a glide. */
  smoothing: number;
  snap: number;

  /** `override`, when given, is the song's `core`: the cores start on it rather than the row. */
  constructor(
    rate: number,
    factor: number,
    model: number,
    override: Readonly<TapeMagneticControls> | null = null,
  ) {
    this.rate = rate;
    this.oversamplers = [];
    for (let channel = 0; channel < CHANNELS; channel++)
      for (const f of TAPE_OVERSAMPLING) this.oversamplers.push(new TapeOversampler(rate, f));
    this.latency = TAPE_MAGNETIC.span;
    this.dry = new Float64Array(CHANNELS * this.latency);
    this.dryAt = 0;
    this.smoothing = NaN;
    this.smoothing = 1 - exp2(-1 / (rate * C.smoothSeconds * TAPE_PORTABLE_MATH.ln2));
    this.snap = NaN;
    this.snap = C.magneticSnap;
    this.gliding = false;
    this.overridden = override !== null;
    this.custom = new TapeCoreControls();
    if (override !== null) {
      this.custom.drive = override.drive;
      this.custom.width = override.width;
      this.custom.saturation = override.saturation;
    }
    this.target = new TapeCoreControls();
    this.aim(model);
    this.controls = new TapeCoreControls();
    this.controls.drive = this.target.drive;
    this.controls.width = this.target.width;
    this.controls.saturation = this.target.saturation;
    for (let i = 0; i < this.oversamplers.length; i++)
      this.oversamplers[i].configure(this.controls);
    this.active = [this.oversamplers[0], this.oversamplers[TAPE_OVERSAMPLING.length]];
    this.factor = TAPE_OVERSAMPLING[0];
    this.select(factor);
  }

  /**
   * The pair for `value`, the nearest of `TAPE_OVERSAMPLING`. A change resets
   * the newly selected pair to zero state; it is already tuned to the
   * controls, as a settled glide retunes both pairs, or it is retuned by the
   * next `glide`. The pair it leaves keeps its state until it is selected
   * again, when it too starts from zero.
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
   * The target: `model`'s row, or while `overridden` the song's `custom`
   * controls. Those are inside `TAPE_CORE_BOUNDS`, the box qualified for
   * every rate and factor, twice over: the normaliser clamps a song's
   * `core` into it, and each control's parameter has the box as its range,
   * which the browser clamps to. No clamp here, whose constant ends are
   * small integers V8's lower tiers would store into these double fields.
   */
  aim(model: number): void {
    const t = this.target;
    if (!this.overridden) {
      magneticControls(TAPE_MODELS[model].magnetic, t);
      return;
    }
    const c = this.custom;
    t.drive = c.drive;
    t.width = c.width;
    t.saturation = c.saturation;
  }

  /** Once per block: the target is aimed (`aim`), and a glide starts when the controls are not on it. */
  configure(model: number): void {
    this.aim(model);
    const t = this.target,
      s = this.controls;
    if (s.drive !== t.drive || s.width !== t.width || s.saturation !== t.saturation)
      this.gliding = true;
  }

  /**
   * One sample of the glide: each control steps toward its target, snapping
   * to it within `snap`, and the active pair's cores are retuned. When all
   * three are on the target, every core is retuned to it and the glide ends.
   */
  glide(): void {
    const k = this.smoothing,
      snap = this.snap,
      s = this.controls,
      t = this.target;
    s.drive += k * (t.drive - s.drive);
    if (Math.abs(t.drive - s.drive) < snap) s.drive = t.drive;
    s.width += k * (t.width - s.width);
    if (Math.abs(t.width - s.width) < snap) s.width = t.width;
    s.saturation += k * (t.saturation - s.saturation);
    if (Math.abs(t.saturation - s.saturation) < snap) s.saturation = t.saturation;
    this.gliding = s.drive !== t.drive || s.width !== t.width || s.saturation !== t.saturation;
    const cores = this.gliding ? this.active : this.oversamplers;
    for (let i = 0; i < cores.length; i++) cores[i].core.retune(s);
  }
}

export { TapeMagneticStage };
