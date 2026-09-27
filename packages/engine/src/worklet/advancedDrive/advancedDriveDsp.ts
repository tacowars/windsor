/** Oversampled stereo DSP with control smoothing and fade-through-dry topology changes.
 * Render tests cover reconstruction, latency, modulation and transition boundedness.
 */
import { ADVANCED_DRIVE_PARAMETERS } from '../../inserts/advancedDriveParameters';
import { DRIVE_DSP as C } from '../../inserts/advancedDriveConstants';
import { driveGain, driveLfo } from '../../inserts/advancedDriveCurves';
import { DriveFir } from './driveOversample';
import { DriveRouting } from './driveRouting';
import type { DriveControls } from './driveStage';
export type AdvancedDriveParams = Record<string, Float32Array>;
const KEYS = ADVANCED_DRIVE_PARAMETERS.map((p) => p.name);
const DISCRETE = KEYS.filter((k) =>
  /^(route|wave)$|_(shaper|filter|pre|enabled|shaping|filtering)$/.test(k),
);
const CONTINUOUS = KEYS.filter((k) => !DISCRETE.includes(k));
export class AdvancedDriveDsp {
  readonly rate: number;
  readonly smooth: number;
  readonly step: number;
  readonly controls: DriveControls;
  readonly targets: DriveControls;
  readonly graph: DriveRouting;
  readonly up: DriveFir[];
  readonly down: DriveFir[];
  phase: number;
  follower: number;
  lfo: number;
  left: number;
  right: number;
  transition: number;
  pending: boolean;
  counter: number;
  constructor(rate: number, params: AdvancedDriveParams) {
    this.rate = rate;
    this.smooth = 1 - Math.exp(-1 / (rate * C.smoothSeconds));
    this.step = 1 / (rate * C.transitionSeconds);
    this.controls = {};
    this.targets = {};
    for (const p of ADVANCED_DRIVE_PARAMETERS)
      this.controls[p.name] = params[p.name]?.[0] ?? p.defaultValue;
    Object.assign(this.targets, this.controls);
    this.graph = new DriveRouting(rate * C.oversample);
    this.up = [new DriveFir(), new DriveFir()];
    this.down = [new DriveFir(), new DriveFir()];
    this.phase = this.follower = this.lfo = this.left = this.right = this.counter = 0;
    this.transition = 1;
    this.pending = false;
    this.graph.configure(this.controls, 0, 0);
  }
  configure(params: AdvancedDriveParams, _frames: number): void {
    for (const key of KEYS) this.targets[key] = params[key][0];
    this.pending = false;
    for (const key of DISCRETE) if (this.targets[key] !== this.controls[key]) this.pending = true;
  }
  update(left: number, right: number): void {
    const s = this.controls,
      t = this.targets;
    for (const key of CONTINUOUS) {
      s[key] += this.smooth * (t[key] - s[key]);
      if (Math.abs(s[key] - t[key]) < C.silence) s[key] = t[key];
    }
    this.transition = Math.max(
      0,
      Math.min(1, this.transition + (this.pending ? -this.step : this.step)),
    );
    if (this.pending && this.transition === 0) {
      for (const key of DISCRETE) s[key] = t[key];
      this.pending = false;
      this.graph.reset();
      this.counter = 0;
    }
    const level = Math.min(1, Math.max(Math.abs(left), Math.abs(right)) * driveGain(s.sensitivity));
    const seconds = (level > this.follower ? s.attack : s.release) / C.ms;
    this.follower += (1 - Math.exp(-1 / (this.rate * seconds))) * (level - this.follower);
    const hz = s.sync >= 1 / 2 ? s.bpm / (C.secondsPerMinute * s.beats) : s.rate;
    this.phase += hz / this.rate;
    this.phase -= Math.floor(this.phase);
    this.lfo = driveLfo(this.phase, s.wave);
    if (this.counter++ % (C.controlStride / C.oversample) === 0)
      this.graph.configure(s, this.follower, this.lfo);
  }
  tick(left: number, right: number): void {
    this.update(left, right);
    const s = this.controls,
      graph = this.graph;
    let l = 0,
      r = 0;
    for (let phase = 0; phase < C.oversample; phase++) {
      const a = this.up[0].tick(phase === 0 ? left * C.oversample : 0);
      const b = this.up[1].tick(phase === 0 ? right * C.oversample : 0);
      graph.tick(a, b);
      // Fade topology through the unrotated dry path; band dry is otherwise phase matched.
      const dryL = a + this.transition * (graph.dryLeft - a);
      const dryR = b + this.transition * (graph.dryRight - b);
      const wet = this.transition * s.mix;
      const outL = this.down[0].tick(dryL + wet * (graph.left - dryL));
      const outR = this.down[1].tick(dryR + wet * (graph.right - dryR));
      if (phase === 0) {
        l = outL;
        r = outR;
      }
    }
    this.left = left + s.enabled * (l - left);
    this.right = right + s.enabled * (r - right);
  }
}
