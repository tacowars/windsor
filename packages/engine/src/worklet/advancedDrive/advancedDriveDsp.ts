/** Oversampled stereo DSP with control smoothing and fade-through-dry topology changes.
 * Render tests cover reconstruction, latency, modulation and transition boundedness;
 * advancedDriveSmoothing.test.ts pins the original recurrence and full-loop output.
 * The controls are Float64Array slots (`driveSlots.ts`), and a sample passes
 * through fields (`inputLeft` and `inputRight` in, `left` and `right` out), so
 * the render allocates nothing: no double crosses a call as an argument or a
 * return, which V8 boxes across a call it does not inline, and every double
 * field is first written as a double (worklet rules 2 and 7).
 * inserts/advancedDriveAllocation.test.ts pins that on V8.
 */
import { ADVANCED_DRIVE_PARAMETERS } from '../../inserts/advancedDriveParameters';
import { DRIVE_DSP as C, DRIVE_MATH as M } from '../../inserts/advancedDriveConstants';
import { driveLfo } from '../../inserts/advancedDriveCurves';
import type { DriveLfoState } from '../../inserts/advancedDriveCurves';
import { DriveFir } from './driveOversample';
import { DriveRouting } from './driveRouting';
import { DRIVE_KEYS as KEYS, DRIVE_SLOT as S } from './driveSlots';
import type { DriveControls } from './driveSlots';
export type AdvancedDriveParams = Record<string, Float32Array>;
const DISCRETE_KEY = /^(route|wave)$|_(shaper|filter|pre|enabled|shaping|filtering)$/;
/** The slots of the switches, which fade through dry, and of the smoothed controls. */
const DISCRETE = KEYS.flatMap((k, slot) => (DISCRETE_KEY.test(k) ? [slot] : []));
const CONTINUOUS = KEYS.flatMap((k, slot) => (DISCRETE_KEY.test(k) ? [] : [slot]));
export class AdvancedDriveDsp implements DriveLfoState {
  readonly rate: number;
  readonly smooth: number;
  readonly step: number;
  readonly controls: DriveControls;
  readonly targets: DriveControls;
  /** The slots still smoothing this block, the first `activeCount`. */
  readonly activeKeys: Int32Array;
  readonly graph: DriveRouting;
  readonly up: DriveFir[];
  readonly down: DriveFir[];
  inputLeft: number;
  inputRight: number;
  phase: number;
  /** The LFO's shape, for `driveLfo`. */
  wave: number;
  follower: number;
  lfo: number;
  left: number;
  right: number;
  transition: number;
  pending: boolean;
  counter: number;
  activeCount: number;
  constructor(rate: number, params: AdvancedDriveParams) {
    this.rate = rate;
    this.smooth = 1 - Math.exp(-1 / (rate * C.smoothSeconds));
    this.step = 1 / (rate * C.transitionSeconds);
    this.controls = new Float64Array(KEYS.length);
    this.targets = new Float64Array(KEYS.length);
    ADVANCED_DRIVE_PARAMETERS.forEach((p, slot) => {
      this.controls[slot] = params[p.name]?.[0] ?? p.defaultValue;
    });
    this.targets.set(this.controls);
    this.activeKeys = Int32Array.from(CONTINUOUS);
    this.activeCount = 0;
    this.graph = new DriveRouting(rate * C.oversample);
    this.up = [new DriveFir(), new DriveFir()];
    this.down = [new DriveFir(), new DriveFir()];
    // Doubles first written as doubles (worklet rule 7).
    this.inputLeft = this.inputRight = this.phase = this.wave = this.follower = this.lfo = NaN;
    this.left = this.right = this.transition = NaN;
    this.inputLeft = this.inputRight = this.phase = this.follower = this.lfo = 0;
    this.left = this.right = this.counter = 0;
    this.transition = 1;
    this.pending = false;
    this.graph.env = this.graph.lfo = 0;
    this.graph.configure(this.controls);
  }
  configure(params: AdvancedDriveParams, _frames: number): void {
    const s = this.controls,
      t = this.targets;
    for (let k = 0; k < KEYS.length; k++) t[k] = params[KEYS[k]][0];
    this.activeCount = 0;
    // Signed-zero target changes must still pass through the original recurrence.
    for (let i = 0; i < CONTINUOUS.length; i++) {
      const k = CONTINUOUS[i];
      if (!Object.is(t[k], s[k])) this.activeKeys[this.activeCount++] = k;
    }
    this.pending = false;
    for (let i = 0; i < DISCRETE.length; i++)
      if (t[DISCRETE[i]] !== s[DISCRETE[i]]) this.pending = true;
  }
  /** One host sample's smoothing, modulation and control block, from `inputLeft` and `inputRight`. */
  update(): void {
    const s = this.controls,
      t = this.targets,
      keys = this.activeKeys;
    // Keep settled keys until the next block so active storage never shifts per sample.
    for (let i = 0; i < this.activeCount; i++) {
      const k = keys[i];
      s[k] += this.smooth * (t[k] - s[k]);
      if (Math.abs(s[k] - t[k]) < C.silence) s[k] = t[k];
    }
    this.transition = Math.max(
      0,
      Math.min(1, this.transition + (this.pending ? -this.step : this.step)),
    );
    if (this.pending && this.transition === 0) {
      for (let i = 0; i < DISCRETE.length; i++) s[DISCRETE[i]] = t[DISCRETE[i]];
      this.pending = false;
      this.graph.reset();
      this.counter = 0;
    }
    const peak = Math.max(Math.abs(this.inputLeft), Math.abs(this.inputRight));
    // The decibel gain is written in place, not called (advancedDriveCurves.ts).
    const level = Math.min(1, peak * M.decimal ** (s[S.sensitivity] / C.dbDivisor));
    const seconds = (level > this.follower ? s[S.attack] : s[S.release]) / C.ms;
    this.follower += (1 - Math.exp(-1 / (this.rate * seconds))) * (level - this.follower);
    const hz = s[S.sync] >= 1 / 2 ? s[S.bpm] / (C.secondsPerMinute * s[S.beats]) : s[S.rate];
    this.phase += hz / this.rate;
    this.phase -= Math.floor(this.phase);
    this.wave = s[S.wave];
    driveLfo(this);
    if (this.counter++ % (C.controlStride / C.oversample) === 0) {
      this.graph.env = this.follower;
      this.graph.lfo = this.lfo;
      this.graph.configure(s);
    }
  }
  /** One host sample: `inputLeft` and `inputRight` into `left` and `right`. */
  tick(): void {
    this.update();
    const left = this.inputLeft,
      right = this.inputRight,
      s = this.controls,
      graph = this.graph,
      upLeft = this.up[0],
      upRight = this.up[1],
      downLeft = this.down[0],
      downRight = this.down[1];
    let l = 0,
      r = 0;
    for (let phase = 0; phase < C.oversample; phase++) {
      upLeft.input = phase === 0 ? left * C.oversample : 0;
      upLeft.tick();
      upRight.input = phase === 0 ? right * C.oversample : 0;
      upRight.tick();
      const a = upLeft.output,
        b = upRight.output;
      graph.inputLeft = a;
      graph.inputRight = b;
      graph.tick();
      // Fade topology through the unrotated dry path; band dry is otherwise phase matched.
      const dryL = a + this.transition * (graph.dryLeft - a);
      const dryR = b + this.transition * (graph.dryRight - b);
      const wet = this.transition * s[S.mix];
      downLeft.input = dryL + wet * (graph.left - dryL);
      downLeft.tick();
      downRight.input = dryR + wet * (graph.right - dryR);
      downRight.tick();
      if (phase === 0) {
        l = downLeft.output;
        r = downRight.output;
      }
    }
    this.left = left + s[S.enabled] * (l - left);
    this.right = right + s[S.enabled] * (r - right);
  }
}
