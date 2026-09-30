/** One pre/post filter and original shaper per channel, with stateful DC removal.
 * A sample passes through fields (`input` in, `output` out), and the stage reads
 * its controls by slot and its modulation from a `DriveModulation`, so no
 * double crosses a call as an argument or a return, which V8 boxes across a
 * call it does not inline (worklet rule 2). Every double field is first written
 * as a double (rule 7). Pinned by inserts/advancedDriveAllocation.test.ts.
 */
import { DriveFilter } from '../../inserts/advancedDriveFilter';
import type { DriveFilterOptions } from '../../inserts/advancedDriveFilter';
import { DriveShaper } from '../../inserts/advancedDriveCurves';
import {
  DRIVE_DSP as C,
  DRIVE_FILTERS,
  DRIVE_MATH as M,
} from '../../inserts/advancedDriveConstants';
import { driveStageSlots } from './driveSlots';
import type { DriveControls, DriveStageSlots } from './driveSlots';
/** The envelope follower's and the LFO's values at a control block. */
export interface DriveModulation {
  env: number;
  lfo: number;
}
export class DriveStage {
  readonly slots: DriveStageSlots;
  readonly filter: DriveFilter;
  readonly options: DriveFilterOptions;
  /** Its type, amount and bias are the stage's shaper, amount and bias controls. */
  readonly shaper: DriveShaper;
  readonly dcPole: number;
  gain: number;
  dc: number;
  enabled: boolean;
  shaping: boolean;
  filtering: boolean;
  pre: boolean;
  input: number;
  /** `tick`'s result. */
  output: number;
  constructor(rate: number, stage: number) {
    this.slots = driveStageSlots(stage);
    this.filter = new DriveFilter();
    // `configure` writes every option but the rate before the filter reads one.
    this.options = { type: 'lowpass', hz: NaN, q: NaN, gain: NaN, rate };
    this.shaper = new DriveShaper();
    this.dcPole = 1 - Math.exp(-((2 * Math.PI * C.dcHz) / rate));
    // Doubles first written as doubles (worklet rule 7).
    this.gain = this.dc = this.input = this.output = NaN;
    this.shaper.amount = this.shaper.bias = this.shaper.type = this.dc = 0;
    this.shaper.prepare();
    this.gain = 1;
    this.enabled = this.shaping = true;
    this.filtering = this.pre = false;
  }
  configure(s: DriveControls, mod: DriveModulation): void {
    const p = this.slots,
      env = mod.env,
      lfo = mod.lfo,
      shaper = this.shaper;
    // The clamps and the decibel gain are written in place, not called (advancedDriveCurves.ts).
    shaper.amount = Math.max(
      0,
      Math.min(1, s[p.amount] + env * s[p.envAmount] + lfo * s[p.lfoAmount]),
    );
    shaper.bias = Math.max(-1, Math.min(1, s[p.bias] + env * s[p.envBias] + lfo * s[p.lfoBias]));
    this.gain = M.decimal ** (s[p.level] / C.dbDivisor);
    shaper.type = s[p.shaper];
    shaper.prepare();
    this.enabled = s[p.enabled] > 0;
    this.shaping = s[p.shaping] > 0;
    this.filtering = s[p.filtering] > 0;
    this.pre = s[p.pre] > 0;
    const o = this.options;
    o.type = DRIVE_FILTERS[s[p.filter]];
    o.hz = Math.min(
      (o.rate / C.oversample) * C.maxFrequencyRatio,
      s[p.frequency] * 2 ** (env * s[p.envCutoff] + lfo * s[p.lfoCutoff]),
    );
    o.q = s[p.resonance];
    o.gain = s[p.peak];
    this.filter.configure(o);
  }
  /** Drives `input` into `output`. */
  tick(): void {
    let x = this.input;
    if (!this.enabled) {
      this.output = x;
      return;
    }
    const filter = this.filter;
    if (this.filtering && this.pre) {
      filter.x0 = x;
      filter.tick();
      x = filter.y1;
    }
    if (this.shaping) {
      const shaper = this.shaper;
      shaper.input = x;
      shaper.run();
      const shaped = shaper.output;
      // Reject only the nonlinear residual. Zero Amount is identity once the
      // DC tail settles, with no switch when modulation crosses zero.
      this.dc += this.dcPole * (shaped - x - this.dc);
      x = shaped - this.dc;
    }
    if (this.filtering && !this.pre) {
      filter.x0 = x;
      filter.tick();
      x = filter.y1;
    }
    this.output = x * this.gain;
  }
  reset(): void {
    this.dc = 0;
    this.filter.reset();
  }
}
