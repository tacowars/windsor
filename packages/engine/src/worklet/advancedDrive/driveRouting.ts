/** Preallocated stereo route graph. Mid/side encoding uses half-sums for unity decoding.
 * Samples pass through fields (`inputLeft` and `inputRight` in, `left`, `right`,
 * `dryLeft` and `dryRight` out, and `channel`'s own three), and `configure`
 * reads the controls by slot and the modulation from `env` and `lfo`, so no
 * double crosses a call as an argument or a return, which V8 boxes across a
 * call it does not inline (worklet rule 2). Every double field is first written
 * as a double (rule 7). Pinned by inserts/advancedDriveAllocation.test.ts.
 */
import {
  DRIVE_DSP as C,
  DRIVE_MATH as M,
  DRIVE_ROUTE_IDS as R,
} from '../../inserts/advancedDriveConstants';
import { DriveStage } from './driveStage';
import type { DriveModulation } from './driveStage';
import { DRIVE_SLOT as S } from './driveSlots';
import type { DriveControls } from './driveSlots';
import { DriveCrossover } from './driveCrossover';
import { DriveTone } from './driveTone';
export class DriveRouting implements DriveModulation {
  readonly rate: number;
  readonly stages: DriveStage[];
  readonly cross: DriveCrossover[];
  readonly tone: DriveTone[];
  readonly undo: DriveTone[];
  /** The modulation `configure` applies. */
  env: number;
  lfo: number;
  inputLeft: number;
  inputRight: number;
  left: number;
  right: number;
  dryLeft: number;
  dryRight: number;
  /** One channel's operands and result, for `channel`. */
  channelInput: number;
  channelDry: number;
  channelOutput: number;
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
    this.tone = [new DriveTone(rate), new DriveTone(rate)];
    this.undo = [new DriveTone(rate), new DriveTone(rate)];
    // Doubles first written as doubles (worklet rule 7).
    this.env = this.lfo = this.inputLeft = this.inputRight = NaN;
    this.channelInput = this.channelDry = this.channelOutput = NaN;
    this.left = this.right = this.dryLeft = this.dryRight = this.route = this.blend = NaN;
    this.drive = this.output = NaN;
    this.left = this.right = this.dryLeft = this.dryRight = this.route = this.blend = 0;
    this.drive = this.output = 1;
  }
  configure(s: DriveControls): void {
    this.route = s[S.route];
    this.blend = s[S.blend];
    // Decibel gains, written in place, not called (advancedDriveCurves.ts).
    this.drive = M.decimal ** (s[S.drive] / C.dbDivisor);
    this.output = M.decimal ** (s[S.output] / C.dbDivisor);
    for (let i = 0; i < this.stages.length; i++) this.stages[i].configure(s, this);
    for (let c = 0; c < 2; c++) {
      const cross = this.cross[c],
        tone = this.tone[c],
        undo = this.undo[c];
      cross.lowHz = s[S.low];
      cross.highHz = s[S.high];
      cross.configure();
      tone.db = s[S.tone];
      tone.hz = s[S.pivot];
      tone.configure(false);
      undo.db = s[S.tone] * s[S.compensation];
      undo.hz = s[S.pivot];
      undo.configure(true);
    }
  }
  /** Drives `inputLeft` and `inputRight` into `left` and `right`. */
  tick(): void {
    const left = this.inputLeft,
      right = this.inputRight,
      toneLeft = this.tone[0],
      toneRight = this.tone[1];
    toneLeft.x0 = left * this.drive;
    toneLeft.tick();
    toneRight.x0 = right * this.drive;
    toneRight.tick();
    let l = toneLeft.y1,
      r = toneRight.y1;
    this.dryLeft = left;
    this.dryRight = right;
    if (this.route === R.midSide) {
      const mid = this.stages[0],
        side = this.stages[2];
      mid.input = (l + r) / 2;
      mid.tick();
      side.input = (l - r) / 2;
      side.tick();
      l = mid.output + side.output;
      r = mid.output - side.output;
    } else {
      this.channelInput = l;
      this.channelDry = left;
      this.channel(0);
      l = this.channelOutput;
      this.channelInput = r;
      this.channelDry = right;
      this.channel(1);
      r = this.channelOutput;
    }
    const undoLeft = this.undo[0],
      undoRight = this.undo[1];
    undoLeft.x0 = l;
    undoLeft.tick();
    this.left = undoLeft.y1 * this.output;
    undoRight.x0 = r;
    undoRight.tick();
    this.right = undoRight.y1 * this.output;
  }
  /** Channel `c` of every route but mid/side: `channelInput` into `channelOutput`. */
  channel(c: number): void {
    const x = this.channelInput,
      a = this.stages[c],
      b = this.stages[2 + c];
    if (this.route === R.multiband) {
      const split = this.cross[c],
        top = this.stages[2 * 2 + c];
      split.input = x;
      split.dryInput = this.channelDry;
      split.tick();
      if (c === 0) this.dryLeft = split.dry;
      else this.dryRight = split.dry;
      a.input = split.low;
      a.tick();
      b.input = split.mid;
      b.tick();
      top.input = split.high;
      top.tick();
      this.channelOutput = a.output + b.output + top.output;
      return;
    }
    a.input = x;
    a.tick();
    const first = a.output;
    if (this.route === 1 || this.route === 2) {
      b.input = this.route === 1 ? first : x;
      b.tick();
      this.channelOutput = first + this.blend * (b.output - first);
      return;
    }
    this.channelOutput = first;
  }
  /** Indexed loops: `reset` runs once a switch, too rarely for V8 to optimise away a `for…of`'s iterator. */
  reset(): void {
    for (let i = 0; i < this.stages.length; i++) this.stages[i].reset();
    for (let c = 0; c < 2; c++) {
      this.cross[c].reset();
      this.tone[c].reset();
      this.undo[c].reset();
    }
  }
}
