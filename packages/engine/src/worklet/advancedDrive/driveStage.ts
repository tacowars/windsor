/** One pre/post filter and original shaper per channel, with stateful DC removal. */
import { DriveFilter } from '../../inserts/advancedDriveFilter';
import { driveGain, driveShape, unit, bipolar } from '../../inserts/advancedDriveCurves';
import {
  DRIVE_DSP as C,
  DRIVE_FILTERS,
  DRIVE_STAGE_DEFAULTS,
} from '../../inserts/advancedDriveConstants';
export type DriveControls = Record<string, number>;
export class DriveStage {
  readonly keys: Record<string, string>;
  readonly filter: DriveFilter;
  readonly options: { type: string; hz: number; q: number; gain: number; rate: number };
  readonly dcPole: number;
  amount: number;
  bias: number;
  gain: number;
  dc: number;
  enabled: boolean;
  shaping: boolean;
  filtering: boolean;
  pre: boolean;
  shaper: number;
  constructor(rate: number, stage: number) {
    this.keys = Object.fromEntries(
      [
        ...Object.keys(DRIVE_STAGE_DEFAULTS),
        'enabled',
        'shaping',
        'filtering',
        'pre',
        'shaper',
        'filter',
      ].map((key) => [key, `s${stage}_${key}`]),
    );
    this.filter = new DriveFilter();
    this.options = { type: 'lowpass', hz: 12000, q: Math.SQRT1_2, gain: 0, rate };
    this.dcPole = 1 - Math.exp(-((2 * Math.PI * C.dcHz) / rate));
    this.amount = this.bias = this.dc = this.shaper = 0;
    this.gain = 1;
    this.enabled = this.shaping = true;
    this.filtering = this.pre = false;
  }
  configure(s: DriveControls, env: number, lfo: number): void {
    const p = this.keys;
    this.amount = unit(s[p.amount] + env * s[p.envAmount] + lfo * s[p.lfoAmount]);
    this.bias = bipolar(s[p.bias] + env * s[p.envBias] + lfo * s[p.lfoBias]);
    this.gain = driveGain(s[p.level]);
    this.shaper = s[p.shaper];
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
  tick(x: number): number {
    if (!this.enabled) return x;
    if (this.filtering && this.pre) x = this.filter.tick(x);
    if (this.shaping) {
      const shaped = driveShape(x, this.shaper, this.amount, this.bias);
      // Reject only the nonlinear residual. Zero Amount is identity once the
      // DC tail settles, with no switch when modulation crosses zero.
      this.dc += this.dcPole * (shaped - x - this.dc);
      x = shaped - this.dc;
    }
    if (this.filtering && !this.pre) x = this.filter.tick(x);
    return x * this.gain;
  }
  reset(): void {
    this.dc = 0;
    this.filter.reset();
  }
}
