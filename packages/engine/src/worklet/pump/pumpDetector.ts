/**
 * The Pump's onset detector (record `2026-10-13-pump-insert` decision 2):
 * a fast peak follower of the key's level against a slow one-pole follower
 * of the fast one. It fires when the fast follower stands `riseDb` above the
 * slow one and above `PUMP_DETECTOR.floorDb`, no sooner than `holdMs` after
 * the last firing, and re-arms once the gap has fallen to `rearmShare` of
 * the rise. Ratios, never logarithms, on the per-sample path.
 *
 * Invariants: `step` allocates nothing and takes and gives its values
 * through fields (worklet rule 2); every double field is born NaN (rule 7).
 * Pinned by `inserts/pumpDsp.test.ts` (onset latency, hold, re-arm).
 */
import { PUMP_DETECTOR } from '../../inserts/pumpConstants';
import { exp2 } from '../../inserts/tapePortableMath';

const MS_PER_S = 1000;
const DB_PER_DECADE = 20;
const LOG2_10 = 3.321928094887362;
const LOG2_E = 1.4426950408889634;

/** One-pole coefficient for a time constant of `ms` at `rate`. */
function poleOf(ms: number, rate: number): number {
  return 1 - exp2(-LOG2_E / ((rate * ms) / MS_PER_S));
}

/** `db` as a gain ratio, 10^(db/20), in portable arithmetic. */
function ratioOf(db: number): number {
  return exp2((db * LOG2_10) / DB_PER_DECADE);
}

class PumpDetector {
  readonly rate: number;
  /** In: the key's level this sample. Out: whether this sample fired. */
  level: number;
  fired: boolean;
  fast: number;
  slow: number;
  readonly fastAttack: number;
  readonly fastRelease: number;
  readonly slowPole: number;
  readonly floor: number;
  rise: number;
  rearm: number;
  holdFrames: number;
  /** Frames since the last firing, held at `holdFrames` once there. */
  since: number;
  armed: boolean;

  constructor(rate: number) {
    this.rate = this.level = this.fast = this.slow = NaN;
    this.fastAttack = this.fastRelease = this.slowPole = this.floor = NaN;
    this.rise = this.rearm = this.holdFrames = this.since = NaN;
    this.rate = rate;
    this.fastAttack = poleOf(PUMP_DETECTOR.fastAttackMs, rate);
    this.fastRelease = poleOf(PUMP_DETECTOR.fastReleaseMs, rate);
    this.slowPole = poleOf(PUMP_DETECTOR.slowMs, rate);
    this.floor = ratioOf(PUMP_DETECTOR.floorDb);
    this.rise = this.rearm = 1;
    this.holdFrames = 0;
    this.fired = false;
    this.armed = true;
    this.reset();
  }

  /** Sensitivity 0..1 as the rise needed, and the hold in frames. */
  tune(sensitivity: number, holdMs: number): void {
    const D = PUMP_DETECTOR;
    const riseDb = D.riseAtZeroDb + (D.riseAtOneDb - D.riseAtZeroDb) * sensitivity;
    this.rise = ratioOf(riseDb);
    this.rearm = ratioOf(riseDb * D.rearmShare);
    this.holdFrames = (holdMs * this.rate) / MS_PER_S;
  }

  /** Rest: both followers at zero, armed, the hold already served. */
  reset(): void {
    this.level = this.fast = this.slow = 0;
    this.since = this.holdFrames;
    this.armed = true;
    this.fired = false;
  }

  step(): void {
    const x = this.level;
    const fast = this.fast;
    const next = fast + (x > fast ? this.fastAttack : this.fastRelease) * (x - fast);
    this.fast = next;
    const slow = this.slow + this.slowPole * (next - this.slow);
    this.slow = slow;
    if (this.since < this.holdFrames) this.since += 1;
    this.fired = false;
    if (this.armed) {
      if (next > this.floor && next > slow * this.rise && this.since >= this.holdFrames) {
        this.fired = true;
        this.armed = false;
        this.since = 0;
      }
    } else if (next < slow * this.rearm) {
      this.armed = true;
    }
  }
}

export { PumpDetector, poleOf };
