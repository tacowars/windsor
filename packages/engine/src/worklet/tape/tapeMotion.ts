/** Seeded wow/flutter and shared stereo dropout envelope; allocation-free after construction.
 * No double crosses a call on the render's path (worklet rule 2, windsor#228): the DSP writes the
 * three amounts to `wowAmount`, `flutterAmount` and `dropoutAmount` before `advance`, and each draw
 * lands in `drawn`. Every double field is first written as NaN (rule 7). Pinned by
 * `inserts/tapeAllocation.test.ts`. */
import { TAPE_DSP as C } from '../../inserts/tapeConstants';
class TapeMotion {
  state: number;
  wow: number;
  flutter: number;
  wowTarget: number;
  flutterTarget: number;
  wowClock: number;
  flutterClock: number;
  dropoutClock: number;
  dropoutPhase: number;
  dropoutLength: number;
  dropoutDepth: number;
  dropout: number;
  delay: number;
  wowSmooth: number;
  flutterSmooth: number;
  dropoutSmooth: number;
  wowRate: number;
  flutterRate: number;
  previousWowRate: number;
  previousFlutterRate: number;
  /** The amounts `advance` reads, each 0 to 1. */
  wowAmount: number;
  flutterAmount: number;
  dropoutAmount: number;
  /** The last `draw`. */
  drawn: number;
  constructor(
    readonly rate: number,
    seed: number,
  ) {
    this.state = this.wow = this.flutter = this.wowTarget = this.flutterTarget = NaN;
    this.wowClock = this.flutterClock = this.dropoutClock = this.dropoutPhase = NaN;
    this.dropoutLength = this.dropoutDepth = this.dropout = this.delay = NaN;
    this.wowRate = this.flutterRate = this.previousWowRate = this.previousFlutterRate = NaN;
    this.wowAmount = this.flutterAmount = this.dropoutAmount = this.drawn = NaN;
    this.state = seed;
    this.wow = this.flutter = this.wowTarget = this.flutterTarget = 0;
    this.wowClock = this.flutterClock = this.dropoutClock = 0;
    this.dropoutPhase = this.dropoutLength = 1;
    this.dropoutDepth = this.dropout = this.delay = 0;
    this.wowRate = this.previousWowRate = C.wowHz;
    this.flutterRate = this.previousFlutterRate = C.flutterHz;
    this.wowAmount = this.flutterAmount = this.dropoutAmount = this.drawn = 0;
    this.wowSmooth = 1 - Math.exp(-1 / (rate * C.wowSmoothSeconds));
    this.flutterSmooth = 1 - Math.exp(-1 / (rate * C.flutterSmoothSeconds));
    this.dropoutSmooth = 1 - Math.exp(-1 / (rate * C.dropoutSmoothSeconds));
  }
  /** The next uniform draw in [0, 1), into `drawn`. */
  draw(): void {
    // eslint-disable-next-line no-magic-numbers -- mulberry32 algorithm constant, matching sequencing/mulberry32.ts.
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    // eslint-disable-next-line no-magic-numbers -- mulberry32 mixing shifts.
    t = Math.imul(t ^ (t >>> 15), t | 1);
    // eslint-disable-next-line no-magic-numbers -- mulberry32 mixing shifts.
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    // eslint-disable-next-line no-magic-numbers -- mulberry32 unsigned normalization.
    this.drawn = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Test-only: `advance` at these amounts; the Wear macro passes one for all three. */
  tick(wow: number, flutter = wow, dropouts = wow): void {
    this.wowAmount = wow;
    this.flutterAmount = flutter;
    this.dropoutAmount = dropouts;
    this.advance();
  }
  /** One sample of motion at `wowAmount`, `flutterAmount` and `dropoutAmount`. */
  advance(): void {
    const wow = this.wowAmount,
      flutter = this.flutterAmount;
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
      this.draw();
      this.wowTarget = 2 * this.drawn - 1;
    }
    if (--this.flutterClock <= 0) {
      this.draw();
      this.flutterClock =
        this.rate /
        ((C.flutterMinHz + this.drawn * (C.flutterMaxHz - C.flutterMinHz)) *
          (this.flutterRate / C.flutterHz));
      this.draw();
      this.flutterTarget = 2 * this.drawn - 1;
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
    // Perhaps a new dropout, at the dropout amount. Written here, not as a method: it runs once in
    // 0.1 s, too rarely for V8 to inline a call to it or to optimise it alone, and a function left
    // in V8's lower tiers boxes every double it computes (windsor#228).
    if (--this.dropoutClock <= 0) {
      const wear = this.dropoutAmount;
      this.dropoutClock = this.rate * C.dropoutInterval;
      this.draw();
      if (!(this.drawn >= wear * C.dropoutChance)) {
        this.draw();
        this.dropoutDepth = this.drawn * wear;
        this.draw();
        this.dropoutLength = Math.max(1, this.drawn * 2 * C.dropoutSeconds * this.rate);
        this.dropoutPhase = 0;
      }
    }
    const envelope =
      this.dropoutPhase < 1 ? this.dropoutDepth * Math.sin(Math.PI * this.dropoutPhase) : 0;
    this.dropoutPhase = Math.min(1, this.dropoutPhase + 1 / this.dropoutLength);
    this.dropout += this.dropoutSmooth * (envelope - this.dropout);
  }
}
export { TapeMotion };
