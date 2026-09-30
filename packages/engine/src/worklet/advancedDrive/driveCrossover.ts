/** Three LR4 bands: low branch gets upper crossover all-pass; dry gets both all-passes.
 * Summing bypassed bands equals the phase-matched dry reference (render tests).
 * Its operands pass through fields (`lowHz` and `highHz` for `configure`,
 * `input` and `dryInput` for `tick`), never as arguments, which V8 boxes across
 * a call it does not inline (worklet rule 2). Pinned by
 * inserts/advancedDriveAllocation.test.ts.
 */
import { DRIVE_CROSSOVER as C } from '../../inserts/advancedDriveConstants';
import { DriveFilter } from '../../inserts/advancedDriveFilter';
import type { DriveFilterOptions } from '../../inserts/advancedDriveFilter';
export class DriveCrossover {
  readonly filters: DriveFilter[];
  readonly options: DriveFilterOptions;
  /** The crossover frequencies `configure` designs. */
  lowHz: number;
  highHz: number;
  input: number;
  dryInput: number;
  /** `tick`'s results. */
  low: number;
  mid: number;
  high: number;
  dry: number;
  constructor(rate: number) {
    this.filters = Array.from({ length: C.filters }, () => new DriveFilter());
    // `configure` writes the type and frequency before each filter reads them.
    this.options = { type: 'lowpass', hz: NaN, q: Math.SQRT1_2, gain: NaN, rate };
    // Doubles first written as doubles (worklet rule 7).
    this.lowHz = this.highHz = this.input = this.dryInput = NaN;
    this.low = this.mid = this.high = this.dry = NaN;
    this.low = this.mid = this.high = this.dry = 0;
  }
  configure(): void {
    const o = this.options;
    for (let i = 0; i < this.filters.length; i++) {
      o.hz = i < C.pair || i === C.dryLow ? this.lowHz : this.highHz;
      o.type = i >= C.allpassStart ? 'allpass' : i % C.pair < 2 ? 'lowpass' : 'highpass';
      this.filters[i].configure(o);
    }
  }
  /** Splits `input` into `low`, `mid` and `high`, and phase-matches `dryInput` into `dry`. */
  tick(): void {
    const f = this.filters;
    f[0].x0 = this.input;
    f[0].tick();
    f[1].follow(f[0]);
    f[8].follow(f[1]);
    this.low = f[8].y1;
    f[2].x0 = this.input;
    f[2].tick();
    f[3].follow(f[2]);
    f[4].follow(f[3]);
    f[5].follow(f[4]);
    this.mid = f[5].y1;
    f[6].follow(f[3]);
    f[7].follow(f[6]);
    this.high = f[7].y1;
    f[9].x0 = this.dryInput;
    f[9].tick();
    f[10].follow(f[9]);
    this.dry = f[10].y1;
  }
  reset(): void {
    // Indexed: `reset` runs too rarely for V8 to optimise away a `for…of`'s iterator.
    for (let i = 0; i < this.filters.length; i++) this.filters[i].reset();
  }
}
