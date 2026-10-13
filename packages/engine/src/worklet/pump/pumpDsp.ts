/**
 * The Pump's signal path (record `2026-10-13-pump-insert`): a drawn gain
 * shape, retriggered by the key's onsets, on a stereo strip.
 *
 * - **Key:** the larger of the key's two channels' magnitudes each sample,
 *   into `PumpDetector`. The key is the insert's own input, or the mixer's
 *   detector input when `external` (the processor picks).
 * - **Cycle:** a firing puts the phase at 0; it grows by `1 / (length ·
 *   rate)` a sample and, at 1, the shape holds its last level until the next
 *   firing. Before any firing the shape rests at its last level too.
 * - **Gain:** `1 − depth · (1 − level)` (`pumpGain`), through a one-pole
 *   slew of `smoothMs`, which is all that keeps a retrigger or a drawn
 *   vertical step from clicking. No lookahead and no latency: the dry and
 *   the gain are the same sample.
 * - **The switch** (windsor#630): on and off crossfade the gain toward unity
 *   linearly over `INSERT_SWITCH_FADE_S`. Fully off copies the input to the
 *   bit (`bypassed`, which the processor reads). Turned back on from fully
 *   off, the detector, the cycle and the slew start from rest.
 *
 * Invariants: `tick` allocates nothing and takes and gives samples through
 * fields (worklet rule 2); every double field is born NaN (rule 7). Pinned
 * by `inserts/pumpAllocation.test.ts`; the path by `inserts/pumpDsp.test.ts`.
 */
import { INSERT_SWITCH_FADE_S } from '../../inserts/insertConstants';
import { PUMP_DSP } from '../../inserts/pumpConstants';
import { exp2 } from '../../inserts/tapePortableMath';
import { PumpDetector } from './pumpDetector';
import { PumpScope } from './pumpScope';
import { PumpShape } from './pumpShape';
import type { PumpShapeParams } from './pumpShape';

type PumpParams = PumpShapeParams;

const PUMP_MS_PER_S = 1000;
const PUMP_LOG2_E = 1.4426950408889634;

class PumpDsp {
  readonly rate: number;
  readonly detector: PumpDetector;
  readonly shape: PumpShape;
  readonly scope: PumpScope;
  /** In: a sample of the program and of the key. Out: the program's sample after the gain. */
  inputLeft: number;
  inputRight: number;
  keyLeft: number;
  keyRight: number;
  left: number;
  right: number;
  /** Where in the cycle: 0 at a firing, 1 and above at rest. */
  phase: number;
  phaseStep: number;
  depth: number;
  /** The slewed gain, and the slew's pole (1 follows at once). */
  gain: number;
  slew: number;
  /** The switch's fade: 0 unity gain, 1 the shape's; `levelStep` a sample. */
  level: number;
  readonly levelStep: number;
  enabled: boolean;
  /** Fully off: the processor copies its input. */
  bypassed: boolean;
  /** The values the coefficients were built from, so a quantum rebuilds only what moved. */
  lengthMs: number;
  sensitivity: number;
  holdMs: number;
  smoothMs: number;

  constructor(rate: number, params: PumpParams) {
    this.rate = this.inputLeft = this.inputRight = this.keyLeft = this.keyRight = NaN;
    this.left = this.right = this.phase = this.phaseStep = this.depth = NaN;
    this.gain = this.slew = this.level = this.levelStep = NaN;
    this.lengthMs = this.sensitivity = this.holdMs = this.smoothMs = NaN;
    this.rate = rate;
    this.levelStep = 1 / (INSERT_SWITCH_FADE_S * rate);
    this.inputLeft = this.inputRight = this.keyLeft = this.keyRight = this.left = this.right = 0;
    this.detector = new PumpDetector(rate);
    this.shape = new PumpShape(params);
    this.scope = new PumpScope();
    this.enabled = params.enabled[0] >= PUMP_DSP.switchOn;
    this.level = this.enabled ? 1 : 0;
    this.bypassed = !this.enabled;
    this.configure(params);
    this.rest();
  }

  /** The quantum's params: the switch, the shape, and whatever coefficient moved. */
  configure(params: PumpParams): void {
    const enabled = params.enabled[0] >= PUMP_DSP.switchOn;
    if (enabled && this.level === 0 && !this.enabled) this.rest();
    this.enabled = enabled;
    this.bypassed = !enabled && this.level === 0;
    this.shape.load(params);
    this.depth = params.depth[0];
    const lengthMs = params.lengthMs[0];
    if (lengthMs !== this.lengthMs) {
      this.lengthMs = lengthMs;
      this.phaseStep = PUMP_MS_PER_S / (lengthMs * this.rate);
    }
    const sensitivity = params.sensitivity[0],
      holdMs = params.holdMs[0];
    if (sensitivity !== this.sensitivity || holdMs !== this.holdMs) {
      this.sensitivity = sensitivity;
      this.holdMs = holdMs;
      this.detector.tune(sensitivity, holdMs);
    }
    const smoothMs = params.smoothMs[0];
    if (smoothMs !== this.smoothMs) {
      this.smoothMs = smoothMs;
      this.slew =
        smoothMs < PUMP_DSP.smoothFloorMs
          ? 1
          : 1 - exp2(-PUMP_LOG2_E / ((this.rate * smoothMs) / PUMP_MS_PER_S));
    }
  }

  /** From rest: nothing heard yet, the cycle idle, the gain at the shape's resting level. */
  rest(): void {
    this.detector.reset();
    this.phase = 1;
    this.gain = 1 - this.depth * (1 - this.shape.lastLevel);
    this.scope.setActive(this.scope.active);
  }

  /** One sample of `inputLeft`/`inputRight` keyed by `keyLeft`/`keyRight` into `left`/`right`. */
  tick(): void {
    const detector = this.detector,
      shape = this.shape,
      scope = this.scope;
    const kl = this.keyLeft < 0 ? -this.keyLeft : this.keyLeft;
    const kr = this.keyRight < 0 ? -this.keyRight : this.keyRight;
    detector.level = kl > kr ? kl : kr;
    detector.step();
    if (detector.fired) {
      if (scope.active) scope.close();
      this.phase = 0;
      shape.seg = 0;
    }
    const phase = this.phase;
    let value = shape.lastLevel;
    if (phase < 1) {
      shape.phase = phase;
      shape.level();
      value = shape.value;
      if (scope.active) {
        scope.phase = phase;
        scope.level = detector.level;
        scope.add();
      }
      const next = phase + this.phaseStep;
      this.phase = next;
      if (next >= 1 && scope.active) scope.close();
    }
    const target = 1 - this.depth * (1 - value);
    const gain = this.gain + this.slew * (target - this.gain);
    this.gain = gain;
    let applied = gain;
    const level = this.level;
    if (level !== 1 || !this.enabled) {
      applied = 1 + level * (gain - 1);
      const moved = this.enabled ? level + this.levelStep : level - this.levelStep;
      this.level = moved < 0 ? 0 : moved > 1 ? 1 : moved;
    }
    this.left = this.inputLeft * applied;
    this.right = this.inputRight * applied;
  }
}

export { PumpDsp };
export type { PumpParams };
