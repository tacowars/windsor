/** Three LR4 bands: low branch gets upper crossover all-pass; dry gets both all-passes.
 * Summing bypassed bands equals the phase-matched dry reference (render tests).
 */
import { DRIVE_CROSSOVER as C } from '../../inserts/advancedDriveConstants';
import { DriveFilter } from '../../inserts/advancedDriveFilter';
export class DriveCrossover {
  readonly filters: DriveFilter[];
  readonly options: { type: string; hz: number; q: number; gain: number; rate: number };
  low: number;
  mid: number;
  high: number;
  dry: number;
  constructor(rate: number) {
    this.filters = Array.from({ length: C.filters }, () => new DriveFilter());
    this.options = { type: 'lowpass', hz: 200, q: Math.SQRT1_2, gain: 0, rate };
    this.low = this.mid = this.high = this.dry = 0;
  }
  configure(low: number, high: number): void {
    const o = this.options;
    for (let i = 0; i < this.filters.length; i++) {
      o.hz = i < C.pair || i === C.dryLow ? low : high;
      o.type = i >= C.allpassStart ? 'allpass' : i % C.pair < 2 ? 'lowpass' : 'highpass';
      this.filters[i].configure(o);
    }
  }
  tick(x: number, dry: number): void {
    const f = this.filters;
    this.low = f[8].tick(f[1].tick(f[0].tick(x)));
    const upper = f[3].tick(f[2].tick(x));
    this.mid = f[5].tick(f[4].tick(upper));
    this.high = f[7].tick(f[6].tick(upper));
    this.dry = f[10].tick(f[9].tick(dry));
  }
  reset(): void {
    for (const filter of this.filters) filter.reset();
  }
}
