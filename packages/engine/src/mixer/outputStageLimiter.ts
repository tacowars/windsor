/**
 * The output stage's peak limiter (windsor#93 decision 4): stereo-linked,
 * with an optional lookahead, followed by a hard clip at the ceiling.
 *
 * Per frame, `need` is the gain that brings the louder channel down to the
 * ceiling (1 when it is under). Without lookahead the gain follows `need`
 * with a one-pole attack and release, and the final clip catches what the
 * attack lets through. With lookahead the audio is delayed by `D` frames and
 * the gain is the moving average, over D + 1 frames, of the smallest `need`
 * in the D + 1 frames ahead (after the release): every average that covers a
 * peak's frame includes that peak's `need`, so the gain is already down when
 * the peak comes out, and the attack is a ramp across the lookahead.
 *
 * Below the ceiling `need` is exactly 1, so is every stage after it, and the
 * output is the input multiplied by 1: bit for bit the input. The moving
 * average counts the ones it holds, and when it holds nothing else its sum is
 * reset to the exact count, so float drift from a limited passage never
 * leaves a quiet one a hair off unity.
 *
 * Everything is allocated in the constructor; `process` allocates nothing.
 * `outputStageDsp.test.ts` pins the behaviour and `outputStageGolden.test.ts`
 * the render.
 */
import { MS_PER_SECOND, OUTPUT_LIMITER } from './outputStageConstants';

/** The per-frame multiplier of a one-pole smoother with time constant `ms`. */
export function onePole(ms: number, sampleRate: number): number {
  return Math.exp(-MS_PER_SECOND / (ms * sampleRate));
}

/** The limiter's lookahead in frames at `sampleRate`. */
export function lookaheadFrames(table: typeof OUTPUT_LIMITER, sampleRate: number): number {
  return Math.round((table.lookaheadMs * sampleRate) / MS_PER_SECOND);
}

/**
 * What the limiter did since it was last cleared, for the telemetry: the
 * smallest gain it applied, and the largest ratio of a sample to the ceiling
 * that the final clip caught (1 when it caught none).
 */
export interface LimiterActivity {
  minGain: number;
  overshoot: number;
}

export class OutputLimiter {
  /** The frames the audio is delayed by with lookahead on. */
  readonly lookaheadFrames: number = 0;
  private readonly attack: number = 0;
  private readonly release: number = 0;
  private readonly epsilon: number = 0;
  private readonly delayL: Float32Array;
  private readonly delayR: Float32Array;
  /** The sliding minimum's monotonic deque: values and the frame each arrived on. */
  private readonly dequeValue: Float64Array;
  private readonly dequeFrame: Float64Array;
  private readonly box: Float64Array;
  private lookahead = false;
  private ceiling = 1;
  private follower = 1;
  /** The delay line's slot, and the moving average's. */
  private write = 0;
  private boxSlot = 0;
  private frame = 0;
  private head = 0;
  private size = 0;
  private boxSum = 0;
  private boxOnes = 0;

  constructor(sampleRate: number, table: typeof OUTPUT_LIMITER = OUTPUT_LIMITER) {
    this.lookaheadFrames = lookaheadFrames(table, sampleRate);
    this.attack = onePole(table.attackMs, sampleRate);
    this.release = onePole(table.releaseMs, sampleRate);
    this.epsilon = table.unityEpsilon;
    const span = this.lookaheadFrames + 1;
    this.delayL = new Float32Array(Math.max(1, this.lookaheadFrames));
    this.delayR = new Float32Array(Math.max(1, this.lookaheadFrames));
    this.dequeValue = new Float64Array(span);
    this.dequeFrame = new Float64Array(span);
    this.box = new Float64Array(span);
    this.reset();
  }

  /** The ceiling, linear. Takes effect on the next frame, with no reset. */
  setCeiling(ceiling: number): void {
    this.ceiling = ceiling;
  }

  /** Lookahead on or off: the delay line and the gain start over (a click is accepted). */
  setLookahead(on: boolean): void {
    if (on === this.lookahead) return;
    this.lookahead = on;
    this.reset();
  }

  get latency(): number {
    return this.lookahead ? this.lookaheadFrames : 0;
  }

  /** Back to unity and silence. */
  reset(): void {
    this.follower = 1;
    this.write = 0;
    this.boxSlot = 0;
    this.frame = 0;
    this.head = 0;
    this.size = 0;
    this.delayL.fill(0);
    this.delayR.fill(0);
    this.box.fill(1);
    this.boxSum = this.box.length;
    this.boxOnes = this.box.length;
  }

  // eslint-disable-next-line max-params -- a block's two inputs, two outputs and length, as every stage takes them
  process(
    inL: Float32Array,
    inR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    frames: number,
    activity: LimiterActivity,
  ): void {
    const ceiling = this.ceiling;
    const lookahead = this.lookahead;
    const depth = this.delayL.length;
    for (let i = 0; i < frames; i++) {
      const l = inL[i]!;
      const r = inR[i]!;
      const peak = Math.max(Math.abs(l), Math.abs(r));
      const need = peak > ceiling ? ceiling / peak : 1;
      let gain: number;
      let dryL = l;
      let dryR = r;
      if (lookahead) {
        const slot = this.write;
        dryL = this.delayL[slot]!;
        dryR = this.delayR[slot]!;
        this.delayL[slot] = l;
        this.delayR[slot] = r;
        this.write = slot + 1 === depth ? 0 : slot + 1;
        gain = this.average(this.follow(this.slidingMin(need), true));
      } else {
        gain = this.follow(need, false);
      }
      let yL = dryL * gain;
      let yR = dryR * gain;
      if (yL > ceiling || yL < -ceiling || yR > ceiling || yR < -ceiling) {
        const over = Math.max(Math.abs(yL), Math.abs(yR)) / ceiling;
        if (over > activity.overshoot) activity.overshoot = over;
        yL = yL > ceiling ? ceiling : yL < -ceiling ? -ceiling : yL;
        yR = yR > ceiling ? ceiling : yR < -ceiling ? -ceiling : yR;
      }
      if (gain < activity.minGain) activity.minGain = gain;
      outL[i] = yL;
      outR[i] = yR;
    }
  }

  /** The smallest `need` among the last `span` frames: a monotonic deque, O(1) a frame on average. */
  private slidingMin(need: number): number {
    const span = this.box.length;
    const values = this.dequeValue;
    const frames = this.dequeFrame;
    // One frame arrives per call, so at most one leaves: the one `span` frames old.
    if (this.size > 0 && frames[this.head]! <= this.frame - span) {
      this.head = this.head + 1 === span ? 0 : this.head + 1;
      this.size--;
    }
    while (this.size > 0) {
      const back = (this.head + this.size - 1) % span;
      if (values[back]! < need) break;
      this.size--;
    }
    const tail = (this.head + this.size) % span;
    values[tail] = need;
    frames[tail] = this.frame;
    this.size++;
    this.frame++;
    return values[this.head]!;
  }

  /**
   * The attack and release. With lookahead the attack is instant here (the
   * moving average is the ramp); without, it is the one-pole `attack`.
   */
  private follow(target: number, instantAttack: boolean): number {
    let g = this.follower;
    if (target < g) {
      g = instantAttack ? target : target + (g - target) * this.attack;
    } else {
      g = target + (g - target) * this.release;
      if (target === 1 && 1 - g < this.epsilon) g = 1;
    }
    this.follower = g;
    return g;
  }

  /** The moving average over the last `span` gains, exactly 1 when every one of them is. */
  private average(gain: number): number {
    const span = this.box.length;
    const slot = this.boxSlot;
    this.boxSlot = slot + 1 === span ? 0 : slot + 1;
    const old = this.box[slot]!;
    if (old === 1) this.boxOnes--;
    if (gain === 1) this.boxOnes++;
    this.box[slot] = gain;
    if (this.boxOnes === span) {
      this.boxSum = span;
      return 1;
    }
    this.boxSum += gain - old;
    return this.boxSum / span;
  }
}
