/** Original transfer functions. DSP and editor share these, not copies of a reference device.
 *
 * The audio thread runs them (windsor#226), so no double crosses a call as an
 * argument or a return value: V8 boxes one across a call it does not inline,
 * and an optimised function stops inlining altogether, however small the
 * callee, once it has inlined its budget (`--max-inlined-bytecode-size-absolute`),
 * which the drive's render reaches (worklet rule 2). So the operands and
 * results are fields, each `declare`d and first written as a double (rule 7),
 * and a decibel gain (`M.decimal ** (dB / C.dbDivisor)`) or a clamp is written
 * where it is used rather than called. Pinned by
 * inserts/advancedDriveAllocation.test.ts.
 */
import {
  DRIVE_DSP as C,
  DRIVE_SHAPERS,
  DRIVE_MATH as M,
  DRIVE_LFO_IDS as L,
} from './advancedDriveConstants';

/** One stage's shaper. `driveShape` runs one for the editor, so both evaluate one curve. */
export class DriveShaper {
  declare input: number;
  /** An index into DRIVE_SHAPERS. */
  declare type: number;
  declare amount: number;
  declare bias: number;
  /** `run`'s result. */
  declare output: number;
  /** The curve's operand, and then its value. */
  declare point: number;
  /** From the type and amount, by `prepare`. */
  declare name: string;
  declare gain: number;
  declare root: number;
  constructor() {
    this.input = this.type = this.amount = this.bias = this.output = this.point = NaN;
    this.gain = this.root = NaN;
    this.name = DRIVE_SHAPERS[0];
  }
  /** After a change of type or amount: what `run` reads of them. */
  prepare(): void {
    this.gain = M.decimal ** ((this.amount * C.driveScale) / C.dbDivisor);
    this.name = DRIVE_SHAPERS[this.type] ?? 'soft';
    this.root = Math.sqrt(this.gain);
  }
  /** Amount zero is identity; bias offsets the curve but never generates output from silence. */
  run(): void {
    const x = this.input,
      amount = this.amount,
      bias = this.bias;
    if (amount === 0) {
      this.output = x;
      return;
    }
    this.point = x * this.gain + bias;
    this.curve();
    const driven = this.point;
    this.point = bias;
    this.curve();
    const shaped = (driven - this.point) / this.root;
    this.output = x + amount * (shaped - x);
  }
  /** The curve at `point`, written back to `point`. */
  curve(): void {
    const x = this.point;
    switch (this.name) {
      case 'hard':
        this.point = Math.max(-1, Math.min(1, x));
        return;
      case 'diode':
        this.point = x / (1 + Math.abs(x) ** (2 / C.diodeKnee)) ** (C.diodeKnee / 2);
        return;
      case 'tube': {
        const t = Math.tanh(x);
        this.point = t + C.tubeEven * t * t;
        return;
      }
      case 'half-wave':
        this.point = Math.max(0, Math.tanh(x));
        return;
      case 'full-wave':
        this.point = Math.abs(Math.tanh(x));
        return;
      case 'fold':
        this.point = (2 / Math.PI) * Math.asin(Math.sin((x * Math.PI) / 2));
        return;
      case 'crush': {
        const steps = 2 ** Math.round(C.crushBits - C.crushRange * this.amount);
        this.point = Math.round(Math.max(-1, Math.min(1, x)) * steps) / steps;
        return;
      }
      default:
        this.point = Math.sin((Math.max(-1, Math.min(1, x)) * Math.PI) / 2);
    }
  }
}
const EDITOR_SHAPER = new DriveShaper();
/** The shaper's transfer function at one input, for the editor's display. */
export function driveShape(x: number, type: number, amount: number, bias: number): number {
  const shaper = EDITOR_SHAPER;
  shaper.input = x;
  shaper.type = type;
  shaper.amount = amount;
  shaper.bias = bias;
  shaper.prepare();
  shaper.run();
  return shaper.output;
}
/** What the LFO reads and writes. */
export interface DriveLfoState {
  /** 0 to 1. */
  phase: number;
  /** An index into DRIVE_LFO_SHAPES. */
  wave: number;
  /** The LFO's value at `phase`, −1 to 1. */
  lfo: number;
}
export function driveLfo(state: DriveLfoState): void {
  const phase = state.phase,
    wave = state.wave;
  if (wave === 1) state.lfo = 1 - 2 * Math.abs(2 * phase - 1);
  else if (wave === 2) state.lfo = phase < M.half ? 1 : -1;
  else if (wave === L.up) state.lfo = 2 * phase - 1;
  else if (wave === L.down) state.lfo = 1 - 2 * phase;
  else state.lfo = Math.sin(2 * Math.PI * phase);
}
