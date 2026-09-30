/** Seeded wow/flutter and shared stereo dropout envelope; allocation-free after construction. */
import { TAPE_DSP as C } from '../../inserts/tapeConstants';
class TapeMotion {
  state: number;
  wow = 0;
  flutter = 0;
  wowTarget = 0;
  flutterTarget = 0;
  wowClock = 0;
  flutterClock = 0;
  dropoutClock = 0;
  dropoutPhase = 1;
  dropoutLength = 1;
  dropoutDepth = 0;
  dropout = 0;
  delay = 0;
  wowSmooth: number;
  flutterSmooth: number;
  dropoutSmooth: number;
  constructor(
    readonly rate: number,
    seed: number,
  ) {
    this.state = seed;
    this.wowSmooth = 1 - Math.exp(-1 / (rate * C.wowSmoothSeconds));
    this.flutterSmooth = 1 - Math.exp(-1 / (rate * C.flutterSmoothSeconds));
    this.dropoutSmooth = 1 - Math.exp(-1 / (rate * C.dropoutSmoothSeconds));
  }
  random(): number {
    // eslint-disable-next-line no-magic-numbers -- mulberry32 algorithm constant, matching sequencing/mulberry32.ts.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    // eslint-disable-next-line no-magic-numbers -- mulberry32 mixing shifts.
    t = Math.imul(t ^ (t >>> 15), t | 1);
    // eslint-disable-next-line no-magic-numbers -- mulberry32 mixing shifts.
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    // eslint-disable-next-line no-magic-numbers -- mulberry32 unsigned normalization.
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  wowRate = C.wowHz;
  flutterRate = C.flutterHz;
  previousWowRate = C.wowHz;
  previousFlutterRate = C.flutterHz;
  tick(wow: number, flutter = wow, dropouts = wow): void {
    // Rescale the remaining interval so a slow cycle doesn't delay live rate edits.
    if (this.wowRate !== this.previousWowRate) {
      this.wowClock *= this.previousWowRate / this.wowRate;
      this.previousWowRate = this.wowRate;
    }
    if (this.flutterRate !== this.previousFlutterRate) {
      this.flutterClock *= this.previousFlutterRate / this.flutterRate;
      this.previousFlutterRate = this.flutterRate;
    }
    if (--this.wowClock <= 0) {
      this.wowClock = this.rate / this.wowRate;
      this.wowTarget = 2 * this.random() - 1;
    }
    if (--this.flutterClock <= 0) {
      this.flutterClock =
        this.rate /
        ((C.flutterMinHz + this.random() * (C.flutterMaxHz - C.flutterMinHz)) *
          (this.flutterRate / C.flutterHz));
      this.flutterTarget = 2 * this.random() - 1;
    }
    this.wow += this.wowSmooth * (this.wowTarget - this.wow);
    this.flutter += this.flutterSmooth * (this.flutterTarget - this.flutter);
    // Equal amounts keep the original Wear arithmetic and seeded output unchanged.
    const amount = Math.max(wow, flutter);
    const motion =
      wow === flutter
        ? this.wow + Math.max(0, this.flutter)
        : amount > 0
          ? (this.wow * wow + Math.max(0, this.flutter) * flutter) / amount
          : 0;
    this.delay = Math.min(1, Math.abs(motion)) * amount * C.maxDelaySeconds * this.rate;
    if (--this.dropoutClock <= 0) this.rollDropout(dropouts);
    const envelope =
      this.dropoutPhase < 1 ? this.dropoutDepth * Math.sin(Math.PI * this.dropoutPhase) : 0;
    this.dropoutPhase = Math.min(1, this.dropoutPhase + 1 / this.dropoutLength);
    this.dropout += this.dropoutSmooth * (envelope - this.dropout);
  }
  rollDropout(wear: number): void {
    this.dropoutClock = this.rate * C.dropoutInterval;
    if (this.random() >= wear * C.dropoutChance) return;
    this.dropoutDepth = this.random() * wear;
    this.dropoutLength = Math.max(1, this.random() * 2 * C.dropoutSeconds * this.rate);
    this.dropoutPhase = 0;
  }
}
export { TapeMotion };
