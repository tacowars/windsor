/** Preallocated stereo route graph. Mid/side encoding uses half-sums for unity decoding. */
import { DRIVE_DSP as C, DRIVE_ROUTE_IDS as R } from '../../inserts/advancedDriveConstants';
import { driveGain } from '../../inserts/advancedDriveCurves';
import { DriveStage } from './driveStage';
import type { DriveControls } from './driveStage';
import { DriveCrossover } from './driveCrossover';
import { DriveTone } from './driveTone';
export class DriveRouting {
  readonly rate: number;
  readonly stages: DriveStage[];
  readonly cross: DriveCrossover[];
  readonly tone: DriveTone[];
  readonly undo: DriveTone[];
  left: number;
  right: number;
  dryLeft: number;
  dryRight: number;
  route: number;
  blend: number;
  drive: number;
  output: number;
  constructor(rate: number) {
    this.rate = rate;
    this.stages = Array.from(
      { length: C.stages * 2 },
      (_, i) => new DriveStage(rate, Math.floor(i / 2)),
    );
    this.cross = [new DriveCrossover(rate), new DriveCrossover(rate)];
    this.tone = [new DriveTone(), new DriveTone()];
    this.undo = [new DriveTone(), new DriveTone()];
    this.left = this.right = this.dryLeft = this.dryRight = this.route = this.blend = 0;
    this.drive = this.output = 1;
  }
  configure(s: DriveControls, env: number, lfo: number): void {
    this.route = s.route;
    this.blend = s.blend;
    this.drive = driveGain(s.drive);
    this.output = driveGain(s.output);
    for (const stage of this.stages) stage.configure(s, env, lfo);
    for (let c = 0; c < 2; c++) {
      this.cross[c].configure(s.low, s.high);
      this.tone[c].configure(s.tone, s.pivot, this.rate);
      this.undo[c].configure(s.tone * s.compensation, s.pivot, this.rate, true);
    }
  }
  tick(left: number, right: number): void {
    let l = this.tone[0].tick(left * this.drive),
      r = this.tone[1].tick(right * this.drive);
    this.dryLeft = left;
    this.dryRight = right;
    if (this.route === R.midSide) {
      const mid = this.stages[0].tick((l + r) / 2),
        side = this.stages[2].tick((l - r) / 2);
      l = mid + side;
      r = mid - side;
    } else {
      l = this.channel(l, left, 0);
      r = this.channel(r, right, 1);
    }
    this.left = this.undo[0].tick(l) * this.output;
    this.right = this.undo[1].tick(r) * this.output;
  }
  channel(x: number, dry: number, c: number): number {
    const a = this.stages[c],
      b = this.stages[2 + c];
    if (this.route === R.multiband) {
      const split = this.cross[c];
      split.tick(x, dry);
      if (c === 0) this.dryLeft = split.dry;
      else this.dryRight = split.dry;
      return a.tick(split.low) + b.tick(split.mid) + this.stages[2 * 2 + c].tick(split.high);
    }
    const first = a.tick(x);
    if (this.route === 1) return first + this.blend * (b.tick(first) - first);
    if (this.route === 2) return first + this.blend * (b.tick(x) - first);
    return first;
  }
  reset(): void {
    for (const stage of this.stages) stage.reset();
    for (const cross of this.cross) cross.reset();
    for (const tone of this.tone) tone.reset();
    for (const undo of this.undo) undo.reset();
  }
}
