/** Original transfer functions. DSP and editor share these, not copies of a reference device. */
import {
  DRIVE_DSP as C,
  DRIVE_SHAPERS,
  DRIVE_MATH as M,
  DRIVE_LFO_IDS as L,
} from './advancedDriveConstants';

export const driveGain = (db: number): number => M.decimal ** (db / C.dbDivisor);
export const unit = (x: number): number => Math.max(0, Math.min(1, x));
export const bipolar = (x: number): number => Math.max(-1, Math.min(1, x));

function curve(x: number, type: string, amount: number): number {
  switch (type) {
    case 'hard':
      return bipolar(x);
    case 'diode':
      return x / (1 + Math.abs(x) ** (2 / C.diodeKnee)) ** (C.diodeKnee / 2);
    case 'tube': {
      const t = Math.tanh(x);
      return t + C.tubeEven * t * t;
    }
    case 'half-wave':
      return Math.max(0, Math.tanh(x));
    case 'full-wave':
      return Math.abs(Math.tanh(x));
    case 'fold':
      return (2 / Math.PI) * Math.asin(Math.sin((x * Math.PI) / 2));
    case 'crush': {
      const steps = 2 ** Math.round(C.crushBits - C.crushRange * amount);
      return Math.round(bipolar(x) * steps) / steps;
    }
    default:
      return Math.sin((bipolar(x) * Math.PI) / 2);
  }
}
/** Amount zero is identity; bias offsets the curve but never generates output from silence. */
export function driveShape(x: number, type: number, amount: number, bias: number): number {
  if (amount === 0) return x;
  const gain = driveGain(amount * C.driveScale);
  const name = DRIVE_SHAPERS[type] ?? 'soft';
  const shaped =
    (curve(x * gain + bias, name, amount) - curve(bias, name, amount)) / Math.sqrt(gain);
  return x + amount * (shaped - x);
}
export function driveLfo(phase: number, wave: number): number {
  if (wave === 1) return 1 - 2 * Math.abs(2 * phase - 1);
  if (wave === 2) return phase < M.half ? 1 : -1;
  if (wave === L.up) return 2 * phase - 1;
  if (wave === L.down) return 1 - 2 * phase;
  return Math.sin(2 * Math.PI * phase);
}
